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
  autopayContractInstance.listenForOneTimeTipClaimed();

  const { newReportEntities: reports } = await flexClient.request(
    getReportsQuery(timestamp_start, queryId, reporter)
  );

  const { tipAddedEntities: tipsAdded } = await autopayClient.request(
    getTipsAddedQuery(timestamp_start, queryId, reporter)
  );

  if (tipsAdded.length === 0) {
    console.log(
      "No Tips added, please add a tip before claiming a One Time Tip"
    );
    process.exit(0);
  }

  const tipsTimestampsToClaim = await get_tips_timestamps_to_claim(
    tipsAdded,
    queryId,
    autopayContractInstance
  );

  if (tipsTimestampsToClaim.length === 0) {
    console.log("No tips to claim");
    return;
  }

  console.log(`Found ${tipsTimestampsToClaim.length} tips to claim`);

  const reportsToClaimTips = get_reports_timestamps_to_claim_tips(
    reports,
    tipsTimestampsToClaim
  );

  if (reportsToClaimTips.length === 0) {
    console.log("No reports to claim tips");
    return;
  }

  console.log(`Found ${reportsToClaimTips.length} reports to claim tips, timestamps:\n${reportsToClaimTips.map(getFormattedTimestamp)}`)

  try {
    await autopayContractInstance.claimOneTimeTip(queryId, reportsToClaimTips);
    console.log(
      `Claimed ${
        reportsToClaimTips.length
      } tips, timestamps:\n${reportsToClaimTips.map(getFormattedTimestamp)}`
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

async function claimFeedTip(reporter, queryId, timestamp_start, autopayContractInstance) {
  autopayContractInstance.listenForTipClaimed();

  const feeds = await autopayContractInstance.getCurrentFeeds(queryId);

  if (feeds.length === 0) {
    console.log(
      "No feeds available, please add a feed before claiming a Feed Tip"
    );
    process.exit(0);
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

  const statusList = await autopayContractInstance.getRewardClaimStatusList(
    feedId,
    queryId,
    reportsToClaimTips
  );

  const reportsTimestampsNotClaimed = [];

  for (let i = 0; i < statusList.length; i++) {
    if (statusList[i] === true) {
      console.log(
        `Report ${reportsToClaimTips[i]} is not eligible for tip claim (reward already claimed)`
      );
      continue;
    }
    reportsTimestampsNotClaimed.push(reportsToClaimTips[i]);
  }

  if (reportsTimestampsNotClaimed.length === 0) {
    console.log("No reports to claim tips");
    return;
  }

  console.log(`Found ${reportsTimestampsNotClaimed.length} reports to claim tips, timestamps:\n${reportsTimestampsNotClaimed.map(getFormattedTimestamp)}`)

  try {
    await autopayContractInstance.claimTip(
      feedId,
      queryId,
      reportsTimestampsNotClaimed
    );
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
    process.exit(1);
  }

  const queryId = await input({
    message: "Enter query ID (default = SpotPrice pls/usd)",
    default:
      "0x83245f6a6a2f6458558a706270fbcc35ac3a81917602c1313d3bfa998dcc2d4b",
  });

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

  switch (claimType) {
    case "OneTimeTip":
      claimOneTimeTip(reporter, queryId, timestamp_start, autopayContractInstance);
      break;
    case "FeedTip":
      claimFeedTip(reporter, queryId, timestamp_start, autopayContractInstance);
      break;
  }
}

exports.main = main;
