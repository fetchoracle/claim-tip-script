const ethers = require("ethers");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getFormattedTimestamp } = require('./timestamps_utils')

class AutopayContract {
  constructor() {
    this.autopay = null;
    this.oneTimeTipEventsPending = 0;
    this.oneTimeTipEventsHandled = 0;
  }

  async initializeAsync() {
    const abiJSONFile = path.resolve(
      __dirname,
      "artifacts/contracts/Autopay.sol/Autopay.json"
    );
    const { bytecode, abi } = JSON.parse(readFileSync(abiJSONFile));

    const autopayAddress = process.env.AUTOPAY_ADDRESS || '0x0000000000000000000000000000000000000000';
    if (autopayAddress === "0x0000000000000000000000000000000000000000") {
      console.log("AUTOPAY_ADDRESS env variable is not set");
      process.exit(1);
    }

    const providerURL = process.env.PULSE_NETWORK_URL || 'https://rpc.pulsechain.com';

    const privateKey = process.env.ACCT_PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";
    if (privateKey === "0000000000000000000000000000000000000000000000000000000000000000") {
      console.log("ACCT_PRIVATE_KEY env variable is not set");
      process.exit(1);
    }
    
    const provider = new ethers.JsonRpcProvider(providerURL);
    const wallet = new ethers.Wallet(privateKey, provider);

    const Autopay = new ethers.ContractFactory(abi, bytecode, wallet);

    const autopayWithSigner = Autopay.connect(wallet);
    const autopay = autopayWithSigner.attach(autopayAddress);
    console.log("AutoPay deployed to:", await autopay.getAddress());

    this.autopay = autopay;
  }

  listenForOneTimeTipClaimed(_queryId, timeoutDuration = 120000) {
    console.log(`Listening for OneTimeTipClaimed events queryId=${_queryId}...`);

    const listener = (queryId, amount, reporter) => {
        console.log("--------------------");
        console.log("OneTimeTipClaimed event emitted");
        console.log("queryId:", queryId);
        console.log("amount:", amount.toString());
        console.log("reporter:", reporter);
        console.log("--------------------");
        this.oneTimeTipEventsHandled++;

        if (this.oneTimeTipEventsHandled === this.oneTimeTipEventsPending) {
          this.oneTimeTipEventsPending = 0;
          this.oneTimeTipEventsHandled = 0;

          this.autopay.off("OneTimeTipClaimed", listener);

          clearTimeout(timeoutId);
        }
    };

    const timeoutId = setTimeout(() => {
        this.autopay.off("OneTimeTipClaimed", listener);
        console.log(`Listener for queryId ${_queryId} removed after timeout`);
    }, process.env.LISTENER_TIMEOUT_DURATION * 1000 || timeoutDuration);

    this.autopay.on("OneTimeTipClaimed", listener);

    return listener;
  }

  addOneTimeTipEventsToQueue(eligibleReports) {
    eligibleReports.forEach(() => {
      this.oneTimeTipEventsPending++;
    });
  }

  listenForTipClaimed(_queryId, _feedId, _timestamp, timeoutDuration = 120000) {
    const listener = (feedId, queryId, amount, reporter) => {
        if (_queryId !== queryId) {
            return;
        }
        if (_feedId !== feedId) {
            return;
        }

        console.log("--------------------");
        console.log("TipClaimed event emitted");
        console.log("feedId:", feedId);
        console.log("queryId:", queryId);
        console.log("amount:", amount.toString());
        console.log("reporter:", reporter);
        console.log("timestamp:", _timestamp.toString(), "(", getFormattedTimestamp(_timestamp), ")");
        console.log("--------------------");

        this.autopay.off("TipClaimed", listener);

        clearTimeout(timeoutId);
    };

    const timeoutId = setTimeout(() => {
        this.autopay.off("TipClaimed", listener);
    }, process.env.LISTENER_TIMEOUT_DURATION * 1000 || timeoutDuration);

    this.autopay.on("TipClaimed", listener);

    return listener;
  }

  static async create() {
    const instance = new AutopayContract();
    try {
      await instance.initializeAsync();
    } catch (error) {
      console.error("Error initializing AutopayContract:", error);
      process.exit(1);
    }
    return instance;
  }

  async claimOneTimeTip(queryId, reportsTimestamps) {
    return await this.autopay.claimOneTimeTip(queryId, reportsTimestamps);
  }

  async getDecodedPastTips(queryId) {
    const pastTips = await this.autopay.getPastTips(queryId);

    const decodedPastTips = pastTips.map(
      ([amount, timestamp, cumulativeTips]) => ({
        amount: Number(amount),
        timestamp: Number(timestamp),
        cumulativeTips,
      })
    );
    return decodedPastTips;
  }

  async getCurrentFeeds(queryId) {
    return await this.autopay.getCurrentFeeds(queryId);
  }

  async getDataFeed(feedId) {
    return await this.autopay.getDataFeed(feedId);
  }

  async getFundedFeedDetails() {
    return await this.autopay.getFundedFeedDetails();
  }

  async getRewardClaimStatusList(feedId, queryId, reportsTimestamps) {
    const rewardsStatus = await this.autopay.getRewardClaimStatusList(
      feedId,
      queryId,
      reportsTimestamps
    );
    return rewardsStatus;
  }

  async claimTip(feedId, queryId, reportsTimestamps) {
    return await this.autopay.claimTip(feedId, queryId, reportsTimestamps);
  }

  async getDataBefore(queryId, timestamp) {
    const data = await this.autopay.getDataBefore(queryId, timestamp);
    return data;
  }
}

exports.AutopayContract = AutopayContract;
