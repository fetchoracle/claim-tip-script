const { gql } = require("graphql-request");

function getReportsQuery(_time_gte, _queryId, _reporter) {
  return gql`
    query {
      newReportEntities(orderBy: _time, orderDirection: asc, where: {
        _time_gte: ${_time_gte},
        _queryId: "${_queryId}",
        _reporter: "${_reporter}"
      }) {
        id
        _nonce
        _queryData
        _queryId
        _time
        _value
        _reporter
        txnHash
      }
    }
  `;
}

function getTipsAddedQuery(_startTime_gte, _queryId, _tipper) {
  return gql`
    query {
      tipAddedEntities(orderBy: _startTime, orderDirection: asc, where: {
        _startTime_gte: ${_startTime_gte},
        _queryId: "${_queryId}",
        _tipper: "${_tipper}"
      }) {
        id
        _queryId
        _amount
        _queryData
        _tipper
        _startTime
        txnHash
        __typename
      }
    }
  `;
}

function getNewDataFeedQuery(_feedId) {
  return gql`
    query {
      newDataFeedEntities(
        where: {
          _feedId: "${_feedId}"
        }
      ) {
        id
        _queryId
        _queryData
        _feedCreator
        __typename
        _feedId
      }
    }
  `;
}

function getDataFeedQuery(id) {
  return gql`
    query {
      dataFeedEntities(where: { id: "${id}" }) {
        id
        _reward
        _startTime
        _interval
        _window
        _priceThreshold
        _queryData
        txnHash
        __typename
      }
    }
  `;
}

exports.getReportsQuery = getReportsQuery;
exports.getTipsAddedQuery = getTipsAddedQuery;
exports.getNewDataFeedQuery = getNewDataFeedQuery;
exports.getDataFeedQuery = getDataFeedQuery;
