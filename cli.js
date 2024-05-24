const { input, confirm, select } = require("@inquirer/prompts");
const {
  getReportsQuery,
  getTipsAddedQuery,
  getDataFeedQuery,
  getNewDataFeedQuery,
} = require("./queries");
const { flexClient, autopayClient } = require("./subgraphClients");
const { AutopayContract } = require("./AutopayContract");
const {
  getFormattedTimestamp,
  getYesterdayUnixTimestamp,
} = require("./timestamps_utils");
const { getAllQueryIds } = require("./queries");

function binarySearch(pastTips, target_timestamp) {
  let left = 0;
  let right = pastTips.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);

    if (target_timestamp <= pastTips[mid].timestamp) {
      right = mid;
    } else {
      left = mid + 1;
    }
  }

  return left;
}

async function get_tips_timestamps_to_claim(
  tipsAdded,
  queryId,
  autopayContractInstance
) {
  const { _startTime: oldestTipTimestamp } = tipsAdded[0];

  const pastTips = await autopayContractInstance.getDecodedPastTips(queryId);

  const oldestTipTimestamp_idx = binarySearch(
    pastTips,
    Number(oldestTipTimestamp) + 1
  );
  // tipsAdded.startTime has 1 diff pastTips.timestamp

  const tipTimestampsToClaim = [];

  for (let i = oldestTipTimestamp_idx; i < pastTips.length; i++) {
    const { amount, timestamp } = pastTips[i];
    if (amount === 0) continue;
    tipTimestampsToClaim.push(timestamp);
  }

  return tipTimestampsToClaim;
}

function get_reports_timestamps_to_claim_tips(reports, tipTimestampsToClaim) {
  const reportsToClaimTips = [];
  let reportIndex = 0;

  for (
    let tipIndex = 0;
    tipIndex < tipTimestampsToClaim.length && reportIndex < reports.length;
    tipIndex++
  ) {
    let tipTimestamp = tipTimestampsToClaim[tipIndex];
    let reportTimestamp = reports[reportIndex]._time;

    const nextTipTimestamp =
      tipIndex < tipTimestampsToClaim.length - 1
        ? tipTimestampsToClaim[tipIndex + 1]
        : Number.MAX_SAFE_INTEGER;

    while (
      reportIndex < reports.length &&
      reportTimestamp < tipTimestamp &&
      reportTimestamp < nextTipTimestamp
    ) {
      reportTimestamp = reports[reportIndex++]._time;
    }

    if (reportTimestamp < tipTimestamp || reportTimestamp >= nextTipTimestamp)
      continue;

    reportsToClaimTips.push(reportTimestamp);
  }

  return reportsToClaimTips;
}

async function claimOneTimeTip(reporter, queryId, timestamp_start, autopayContractInstance) {
  autopayContractInstance.listenForOneTimeTipClaimed(queryId);

  const { newReportEntities: reports } = await flexClient.request(
    getReportsQuery(timestamp_start, queryId, reporter)
  );

  const { tipAddedEntities: tipsAdded } = await autopayClient.request(
    getTipsAddedQuery(timestamp_start, queryId, reporter)
  );

  if (tipsAdded.length === 0) {
    console.log(
      `No Tips added for queryId ${queryId}, please add a tip before claiming a One Time Tip`
    );
    return;
  }

  const tipsTimestampsToClaim = await get_tips_timestamps_to_claim(
    tipsAdded,
    queryId,
    autopayContractInstance
  );

  if (tipsTimestampsToClaim.length === 0) {
    console.log(`No tips to claim for queryId ${queryId}`);
    return;
  }

  console.log(`Found ${tipsTimestampsToClaim.length} tips to claim for queryId ${queryId}`);

  const reportsToClaimTips = get_reports_timestamps_to_claim_tips(
    reports,
    tipsTimestampsToClaim
  );

  const eligibleReports = getEligibleReports(reportsToClaimTips, true);

  if (eligibleReports.length === 0) {
    console.log(`No eligible reports to claim tips for queryId ${queryId}`);
    return;
  }

  console.log(
    `Found ${eligibleReports.length} reports to claim tips for queryId ${queryId}
    - Reports timestamp:
        ${eligibleReports.map((timestamp) => `${getFormattedTimestamp(timestamp)} (${timestamp})\n`)}
    `
  )

  try {
    const result = await autopayContractInstance.claimOneTimeTip(queryId, eligibleReports);
    await result.wait()
    console.log(
      `Claimed ${
        eligibleReports.length
      } tips, timestamps:\n${eligibleReports.map(getFormattedTimestamp)}`
    );
  } catch (error) {
    if (error.reason === "tip already claimed")
      console.log("Some tips were already claimed, algorithm error");
    else if (error.reason === "buffer time has not passed")
      console.log(
        "Buffer time of 12 hours has not passed since the report timestamp. Please wait and try again later"
      );
    else {
      throw error;
    }
  }
}

function getEligibleReports(reports_timestamp, is_one_time_tip = false) {
  const twelve_hours = 12 * 60 * 60;
  const four_weeks = 4 * 7 * 24 * 60 * 60;

  const current_time_seconds = Math.floor(Date.now() / 1000);
  const buffer_time = parseInt(process.env.BUFFER_TIME) || twelve_hours;
  const report_timestamp_timeout = parseInt(process.env.REPORT_TIMESTAMP_TIMEOUT) || four_weeks;

  const has_condition_one_time_tip = (age) => age >= buffer_time;
  const has_condititon_feed_tip = (age) => age >= buffer_time && age <= report_timestamp_timeout;

  const has_conditition = is_one_time_tip ? has_condition_one_time_tip : has_condititon_feed_tip;

  const eligibleReports = reports_timestamp.filter((report_timestamp) => {
      const age = current_time_seconds - report_timestamp;
      return has_conditition(age);
    }
  );

  return eligibleReports;
}

async function claimFeedTip(reporter, queryId, timestamp_start, autopayContractInstance) {
  autopayContractInstance.listenForTipClaimed(queryId);

  const feeds = await autopayContractInstance.getCurrentFeeds(queryId);

  if (feeds.length === 0) {
    console.log(
      `No feeds available for queryId ${queryId}, please add a feed before claiming a Feed Tip`
    );
    return;
  }

  const feedId = await select({
    message: "Select a Feed ID",
    choices: feeds.map((feed) => ({
      value: feed,
    })),
  });

  const { newReportEntities: reports } = await flexClient.request(
    getReportsQuery(timestamp_start, queryId, reporter)
  );

  const {
    newDataFeedEntities: [{ id: dataFeedEntityID }],
  } = await autopayClient.request(getNewDataFeedQuery(feedId));

  const {
    dataFeedEntities: [dataFeed],
  } = await autopayClient.request(getDataFeedQuery(dataFeedEntityID));

  // get the reports timestamps that come after the dataFeed._startime
  const reportsToClaimTips = get_reports_timestamps_to_claim_tips(reports, [
    dataFeed._startTime,
  ]);

  const eligibleReports = getEligibleReports(reportsToClaimTips, false);

  if (eligibleReports.length === 0) {
    console.log(`No eligible reports to claim tips for queryId ${queryId}`);
    return;
  }

  const statusList = await autopayContractInstance.getRewardClaimStatusList(
    feedId,
    queryId,
    eligibleReports
  );

  const reportsTimestampsNotClaimed = [];

  for (let i = 0; i < statusList.length; i++) {
    if (statusList[i] === true) {
      console.log(
        `Report ${eligibleReports[i]} is not eligible for tip claim (reward already claimed)`
      );
      continue;
    }
    reportsTimestampsNotClaimed.push(eligibleReports[i]);
  }

  if (reportsTimestampsNotClaimed.length === 0) {
    console.log(`No reports to claim tips for queryId ${queryId}`);
    return;
  }

  console.log(
    `Found ${reportsTimestampsNotClaimed.length} reports to claim tips for queryId ${queryId}
    - Reports timestamp:
        ${reportsTimestampsNotClaimed.map((timestamp) => `${getFormattedTimestamp(timestamp)} (${timestamp})\n`)}
    `
  )

  try {
    const result = await autopayContractInstance.claimTip(
      feedId,
      queryId,
      reportsTimestampsNotClaimed
    );
    await result.wait()
    console.log(
      `Claimed ${
        reportsTimestampsNotClaimed.length
      } tips, timestamps:\n${reportsTimestampsNotClaimed.map(
        getFormattedTimestamp
      )}`
    );
  } catch (error) {
    console.log("Error:");
    if (error.reason === "reward already claimed") {
      console.log("Reward already claimed, algorithm error");
      console.log(error)
    }
    else if (error.reason === "buffer time has not passed")
      console.log(
        "Buffer time of 12 hours has not passed since the report timestamp. Please wait and try again later"
      );
    else {
      throw error;
    }
  }
}

async function main() {
  const autopayContractInstance = await AutopayContract.create();

  const reporter = process.env.ACCT_PUBLIC_KEY;

  const public_key = await confirm({
    message: `Confirm ${reporter} as the reporter public key`,
    default: true,
  });

  if (!public_key) {
    console.error("Please set ACCT_PUBLIC_KEY in the .env file");
    return;
  }

  const timestamp_start = await input({
    message: "Enter a start timestamp to lookup for reports (default = yesterday in unix timestamp))",
    default: getYesterdayUnixTimestamp(),
  });

  const claimType = await select({
    message: "Select a Tip to claim",
    choices: [
      { value: "OneTimeTip", name: "One Time Tip" },
      { value: "FeedTip", name: "Feed Tip" },
    ],
  });

  const allQueryIds = await getAllQueryIds();
  const claimFunction = claimType === "OneTimeTip" ? claimOneTimeTip : claimFeedTip;

  for (const queryId of allQueryIds) {
    await claimFunction(reporter, queryId, timestamp_start, autopayContractInstance);
  }
}

exports.main = main;
