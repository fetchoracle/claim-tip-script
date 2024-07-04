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

function handleRevertError(error, revertInfo=null) {
  const errorMessages = {
    "tip already claimed": "Some tips were already claimed, algorithm error",
    "reward already claimed": "Reward already claimed, algorithm error",
    "buffer time has not passed": "Buffer time of 12 hours has not passed since the report timestamp. Please wait and try again later",
    "timestamp too old to claim tip": "Timestamp too old to claim tip, algorithm error",
    "price threshold not met": "Price threshold not met",
    "no funds available for this feed": "No funds available for this feed",
  };

  if (revertInfo) {
    console.log(`
      Error claiming tip with timestamp ${getFormattedTimestamp(revertInfo.timestamp)}:
      FeedId: ${revertInfo.feedId ? revertInfo.feedId : 'N/A (One Time Tip)'}
      QueryId: ${revertInfo.queryId}
      timestamp: ${revertInfo.timestamp}
    `);
  }

  const errorMessage = errorMessages[error.reason];

  if (!errorMessage && error.reason) {
    console.log(`Error: ${error.reason}`);
    return;
  }

  if (!errorMessage) {
    console.log('Unexpected error:')
    console.log(error)
    return
  }

  console.log(errorMessage);
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

async function getTimestampBefore(queryId, autopayContractInstance, reportTimestamp) {
  const timestampBefore = await autopayContractInstance.getDataBefore(queryId, reportTimestamp);
  const [value, timestamp] = timestampBefore;
  return parseInt(timestamp.toString());
}

async function get_reports_timestamps_to_claim_tips(queryId, autopayContractInstance, reports, tipTimestampsToClaim) {
  const reportsToClaimTips = [];
  let reportIndex = 0;

  for (let tipIndex = 0; tipIndex < tipTimestampsToClaim.length; tipIndex++) {
    const tipTimestamp = tipTimestampsToClaim[tipIndex];
    const isLastTip = tipIndex >= tipTimestampsToClaim.length - 1;
    const nextTipTimestamp = isLastTip ? Number.MAX_SAFE_INTEGER : tipTimestampsToClaim[tipIndex + 1];

    while (reportIndex < reports.length && Number(reports[reportIndex]._time) < Number(nextTipTimestamp)) {
      const reportTimestamp = Number(reports[reportIndex]._time);
      const timestampBefore = await getTimestampBefore(queryId, autopayContractInstance, reportTimestamp);

      if (timestampBefore < tipTimestamp && reportTimestamp >= tipTimestamp && reportTimestamp < nextTipTimestamp) {
        reportsToClaimTips.push(reportTimestamp);
        break;
      }

      reportIndex++;
    }
  }

  return reportsToClaimTips;
}

function get_reports_timestamps_to_claim_feed_tips(reports, [dataFeed_startTime]) {
  const reportsToClaimTips = reports.filter(report => report._time >= dataFeed_startTime);
  return reportsToClaimTips.map(report => report._time);
}

async function claimOneTimeTips(reporter, queryId, timestamp_start, autopayContractInstance) {
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

  const reportsToClaimTips = await get_reports_timestamps_to_claim_tips(
    queryId,
    autopayContractInstance,
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

  autopayContractInstance.listenForOneTimeTipClaimed(queryId);
  autopayContractInstance.addOneTimeTipEventsToQueue(eligibleReports);
  for (const timestamp of eligibleReports) {
    try {
      const result = await autopayContractInstance.claimOneTimeTip(queryId, [timestamp]);
      console.log(`Claimed one-time tip with timestamp ${getFormattedTimestamp(timestamp)} (${timestamp})`)
      await result.wait();
    } catch (error) {
      handleRevertError(error, { queryId, timestamp });
    }
  }
}

function getEligibleReports(reportsTimestamp, isOneTimeTip = false) {
  const twelveHoursInSeconds = 12 * 60 * 60;
  const fourWeeksInSeconds = 4 * 7 * 24 * 60 * 60;

  const bufferTime = parseInt(process.env.BUFFER_TIME) || twelveHoursInSeconds;
  const reportTimestampTimeout = parseInt(process.env.REPORT_TIMESTAMP_TIMEOUT) || fourWeeksInSeconds;

  const currentTimeSeconds = Math.floor(Date.now() / 1000);

  const isEligible = isOneTimeTip
    ? (age) => age >= bufferTime
    : (age) => age >= bufferTime && age <= reportTimestampTimeout;

  const logIneligibleReport = (reportTimestamp, age) => {
    const isWithinBufferTime = age >= bufferTime;
    const isWithinReportTimestampTimeout = age <= reportTimestampTimeout;

    const oneTimeTipComparison = `${age} >= ${bufferTime} = ${isWithinBufferTime}`;
    const feedTipComparison = `${bufferTime} <= ${age} <= ${reportTimestampTimeout} =  ${isWithinBufferTime && isWithinReportTimestampTimeout}`;

    const comparisonConditionInfo = isOneTimeTip
      ? `age >= bufferTime: ${oneTimeTipComparison}`
      : `Buffer time <= age <= reportTimestampTimeout: ${feedTipComparison}`;

    console.log(`
      Report ${reportTimestamp} (${getFormattedTimestamp(reportTimestamp)}) is not eligible for tip claim.
      Timestamp age: ${age} seconds
      Buffer time: ${bufferTime} seconds
      Report timestamp timeout: ${reportTimestampTimeout} seconds
      ${comparisonConditionInfo}
    `);
  };

  const eligibleReports = reportsTimestamp.filter(reportTimestamp => {
    const age = currentTimeSeconds - reportTimestamp;
    const isReportEligible = isEligible(age);

    if (!isReportEligible) {
      logIneligibleReport(reportTimestamp, age);
    }

    return isReportEligible;
  });

  return eligibleReports;
}


async function claimFeedTip(reporter, queryId, timestamp_start, autopayContractInstance, feedId) {
  console.log(`Checking eligible reports timestamps for FeedTip Id ${feedId}`);

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
  const reportsToClaimTips = get_reports_timestamps_to_claim_feed_tips(reports, [
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

  for (const timestamp of reportsTimestampsNotClaimed) {
    autopayContractInstance.listenForTipClaimed(queryId, feedId, timestamp);
    try {
      const result = await autopayContractInstance.claimTip(
        feedId,
        queryId,
        [timestamp]
      );
      console.log(
        `
        Claimed tip with timestamp ${getFormattedTimestamp(timestamp)}:
        Timestamp: ${timestamp}
        FeedId: ${feedId}
        QueryId: ${queryId}
        `
      );
      await result.wait();
    } catch (error) {
      handleRevertError(error, {
        feedId,
        queryId,
        timestamp
      });
    }
  }
}

async function claimFeedTips(reporter, queryId, timestamp_start, autopayContractInstance) {
  const feeds = await autopayContractInstance.getCurrentFeeds(queryId);

  if (feeds.length === 0) {
    console.log(
      `No feeds available for queryId ${queryId}, please add a feed before claiming a Feed Tip`
    );
    return;
  }

  for (const feedId of feeds) {
    await claimFeedTip(reporter, queryId, timestamp_start, autopayContractInstance, feedId);
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
  const claimFunction = claimType === "OneTimeTip" ? claimOneTimeTips : claimFeedTips;

  for (const queryId of allQueryIds) {
    await claimFunction(reporter, queryId, timestamp_start, autopayContractInstance);
  }
}

exports.main = main;
