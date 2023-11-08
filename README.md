# Claim Tip CLI

## Claiming a tip

1. Create a tip (one time tip or feed)

2. Make a report

3. Use the claim-tip-script

## Claim one time tip

Run `npm run start`, select "One Time Tip", then it will confirm the reporter public key address, and prompts the user to enter a query id and a initial timestamp to look for reports to claim tips.

```sh
AutoPay deployed to: <autopay-contract-address>
Listening for OneTimeTipClaimed events...
? Confirm <reporter-public-key> as the reporter public key yes
? Enter query ID (default = SpotPrice pls/usd) <query-id>
? Enter a start timestamp (default = yesterday in unix timestamp)) <initial-timestamp>
Found 1 tips to claim
Found 1 reports to claim tips
Claimed 1 tips, timestamps:
July 17, 2023 12:35:49 PM
--------------------
OneTimeTipClaimed event emitted
queryId: <query-id>
amount: <tip-amount>
reporter: <reporter-public-key>
--------------------
```

This CLI claim tips through the following steps:

1. Query the flex and autopay subgraphs given the initial timestamp, query Id, and reporter.

2. Then, it will retrieve all and show a message to the user of the number of tips available to be claimed.

3. The program will search for reports that can claim the tips just found

4. Once it has found tips that have not been reclaimed already and reports eligible to claim those tips, it will call the autopay `claimOneTimeTip` function by passing the proper timestamps reports.

## Claim feed tip

Run `npm run start` select "Feed Tip", then it will confirm the reporter public key address, and prompts the user to enter a query id, a feed it and a initial timestamp to look for reports to claim tips.

```sh
AutoPay deployed to: <autopay-contract-address>
? Select a Tip to claim Feed Tip
Listening for TipClaimed events...
? Enter query ID (default = SpotPrice pls/usd) <query-id>
? Select a Feed ID <feed-id>
? Enter a start timestamp (default = yesterday in unix timestamp)) <initial-timestamp>
Claimed 1 tips, timestamps:
July 20, 2023 1:23:59 PM
--------------------
TipClaimed event emitted
feedId: <feed-id-selected>
queryId: <query-id>
amount: <tip-amount>
reporter: <reporter-public-key>
--------------------
```

This CLI claim tips through the following steps:

1. Query the current feeds by calling the `getCurrentFeeds` function in the autopay contract, so that the user can select the feed id.

2. Get the reports from the flex subgraph.

3. Given the feed id, it will look for eligible reports from the feed start time, it will also get the reports that have not claimed the reward ye from the `getRewardClaimStatusList` autopay contract function.

4. Once it has found the feed and reports that can claim rewards, it will call the autopay `claimTip` function by passing the proper timestamps reports.
