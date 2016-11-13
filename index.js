'use static';

const Promise = require('promise');
const https = require('https');
const url = require('url');
const aws = require('aws-sdk');
const portatext = new (require('portatext')).ClientHttp();

const feedUrl = 'https://www.nasa.gov/rss/dyn/breaking_news.rss';
const googleApp = 'your-google-app-id';
const googleKey = 'your-google-app-ley';
const portatextKey = 'your-portatext-key';
const smsServiceId = 00; // Your SMS service ID
const templateId = 000; // Your template ID for the news

portatext.setApiKey(portatextKey);

function download(feedUrl) {
  return new Promise(function(resolve, reject) {
    logInfo('Downloading ' + feedUrl);
    var options =  url.parse(feedUrl);
    var req = https.request(options, function(res) {
      if(res.statusCode != 200) {
        return reject('Bad status code: ' + res.statusCode);
      }
      var Buffer = require('buffer').Buffer;
      var buffer = new Buffer([]);
      res.on('data', function(data) {
        buffer = Buffer.concat([buffer, data]);
      });
      res.on('end', function() {
        resolve(buffer.toString('utf8'));
      });
    });

    req.on('error', function(e) {
      return reject(error);
    });
    req.end();
  });
}

function toStream(rss) {
  logInfo('Transforming text to a stream');
  var fakeStream = new require('stream').Readable();
  fakeStream._read = function noop() {};
  fakeStream.push(rss);
  fakeStream.push(null);
  return fakeStream;
}

function parse(stream) {
  logInfo('Parsing feed');
  return new Promise(function(resolve, reject) {
    var items = [];
    var FeedParser = require('feedparser');
    var feedParser = new FeedParser([]);
    var fakeStream = new require('stream').Readable();
    stream.pipe(
      new FeedParser()
    ).on('error', function(error) {
      return reject(error);
    }).on('readable', function() {
      while(item = this.read()) {
        items.push(item);
      }
    }).on('end', function() {
      logInfo('Found ' + items.length + ' items');
      return resolve(items);
    });
  });
}

function normalize(items) {
  logInfo('Normalizing items');
  return items.map(function(i) {
    var title = i.title;
    var link = i.link;
    var id = parseInt(i['dc:identifier']['#']);
    var dateString = i['pubDate'].toString();
    var date = Date.parse(dateString);
    return {
      title: title,
      link: link,
      id: id,
      dateString: dateString,
      date: date,
      jobId: null,
      campaignId: null
    }
  });
};

function sort(items) {
  logInfo('Sorting items');
  return items.sort(function(a, b) {
    return a.date < b.date;
  });
};

function pickLatest(items) {
  var item = items[0];
  logInfo('Chosen latest item: ' + JSON.stringify(item));
  return item;
}

function shortenUrl(googleKey, item) {
  logInfo('Shortening ' + item.link);
  return new Promise(function(resolve, reject) {
    var options = url.parse(
      'https://www.googleapis.com/urlshortener/v1/url?key=' + googleKey
    );
    options.method = 'POST';
    options.headers = {
      'content-type': 'application/json'
    };
    var payload = JSON.stringify({
      longUrl: item.link
    });
    var req = https.request(options, function(res) {
      if(res.statusCode != 200) {
        return reject('Bad status code on shorten URL: ' + res.statusCode);
      }
      var Buffer = require('buffer').Buffer;
      var buffer = new Buffer([]);
      res.on('data', function(data) {
        buffer = Buffer.concat([buffer, data]);
      });
      res.on('end', function() {
        var result = JSON.parse(buffer.toString('utf8'));
        item.shortLink = result.id;
        resolve(item);
      });
    });

    req.on('error', function(e) {
      return reject(error);
    });
    req.write(payload);
    req.end();
  });
}

function saveItem(item) {
  return getLastItem().then(function(oldItem) {
    if(oldItem && (oldItem.id === item.id)) {
      logInfo('Same item, skipping update');
      return oldItem;
    }
    logInfo('Saving item to DynamoDB ' + item.id);
    return new Promise(function(resolve, reject) {
      var params = {
        Key: {key: {S: 'last_item'}},
        AttributeUpdates: {
          short_link: {Action: 'PUT', Value: {S: item.shortLink}},
          link: {Action: 'PUT', Value: {S: item.link}},
          title: {Action: 'PUT', Value: {S: item.title}},
          id: {Action: 'PUT', Value: {N: item.id.toString()}},
          date_string: {Action: 'PUT', Value: {S: item.dateString}},
          date: {Action: 'PUT', Value: {N: item.date.toString()}}//,
          //campaign_id: {Action: 'PUT', Value: {NULL: true}},
          //job_id: {Action: 'PUT', Value: {NULL: true}}
        },
        TableName: 'nasanews_settings',
        ReturnConsumedCapacity: 'NONE',
        ReturnItemCollectionMetrics: 'NONE',
        ReturnValues: 'NONE'
      };
      var dynamoDb = new aws.DynamoDB();
      dynamoDb.updateItem(params, function(err, data) {
        if(err) {
          return reject(err);
        }
        return resolve(item);
      });
    });

  });
}

function notifyNewItem() {
  logInfo('Notifying of new item');
  return new Promise(function(resolve, reject) {
    var sns = new aws.SNS();
    var subPayload = JSON.stringify({type: 'new_item'});
    var payload = {
      default: subPayload
    };
    var params = {
      Message: JSON.stringify(payload),
      MessageAttributes: {},
      MessageStructure: 'json',
      Subject: 'NEW_NASANEWS_ITEM',
      TopicArn: 'arn:aws:sns:us-west-2:138322507856:NasaNewsCreateCampaign'
    };
    sns.publish(params, function(err, data) {
      if(err) {
        return reject(err);
      }
      return resolve();
    });
  });
}

function getLastItem() {
  logInfo('Fetching item from DynamoDB');
  return new Promise(function(resolve, reject) {
    var params = {
      Key: {
        key: {S: 'last_item'}
      },
      TableName: 'nasanews_settings',
      ReturnConsumedCapacity: 'NONE'
    };
    var dynamoDb = new aws.DynamoDB();
    dynamoDb.getItem(params, function(err, data) {
      if(err) {
        return reject(err);
      }
      if(Object.keys(data).length === 0) {
        return resolve(null);
      }
      var item = {
        title: data.Item.title.S,
        link: data.Item.link.S,
        shortLink: data.Item.short_link.S,
        id: parseInt(data.Item.id.N),
        dateString: data.Item.date_string.S,
        date: parseInt(data.Item.date.N),
        campaignId: null,
        jobId: null
      };
      if(data.Item.campaign_id) {
        item.campaignId = parseInt(data.Item.campaign_id.N);
      }
      if(data.Item.job_id) {
        item.jobId = parseInt(data.Item.job_id.N);
      }
      return resolve(item);
    });
  });
}

//function getTotalCampaignPages() {
//  return portatext
//    .campaigns()
//    .get()
//    .then(function(result) {
//      return result.data.total_pages;
//    });
//}

function logInfo(msg) {
  log('INFO', msg);
}

function logError(msg) {
  log('ERROR', msg);
}

function log(level, msg) {
  console.log('[' + level + '] ' + msg);
}

//exports.cleanUpCampaigns = function(event, context, callback) {
//  getTotalCampaignPages()
//  .then(function(totalPages) {
//    var promises = [];
//    for(var i = 0; i < totalPages; i++) {
//      promises.push(function() {
//        var page = i;
//        return portatext.campaigns.page(i).get().then(function(result) {
//          console.log(result.data.campaigns);
//        });
//      });
//    }
//    return Promise.all(promises);
//  }).catch(function(err) {
//    logError(JSON.stringify(err));
//    callback(err);
//  });
//};
//

exports.createCampaign = function(event, context, callback) {
  getLastItem().
  then(function(item) {
    if(item.jobId !== null) {
      logInfo(
        'Not creating a new campaign id for item ' + JSON.stringify(item)
      );
      return null;
    }
    logInfo('Creating a new campaign for item ' + item.id);
    return portatext
      .smsCampaign()
      .name('NASANEWS ' + item.id)
      .description(item.title)
      .fromService(smsServiceId)
      .allSubscribers()
      .useTemplate(templateId, {title: item.title, link: item.shortLink})
      .post()
      .then(function(result) {
        if(!result.success) {
          return Promise.reject(result);
        }
        return {jobId: result.data.job_id, item: item};
      });
  }).then(function(result) {
    if(result === null) {
      return null;
    }
    var jobId = result.jobId;
    logInfo('Saving job id ' + jobId +  ' to DynamoDB ' + result.item.id);
    return new Promise(function(resolve, reject) {
      var params = {
        Key: {key: {S: 'last_item'}},
        AttributeUpdates: {
          job_id: {Action: 'PUT', Value: {N: jobId.toString()}},
        },
        TableName: 'nasanews_settings',
        ReturnConsumedCapacity: 'NONE',
        ReturnItemCollectionMetrics: 'NONE',
        ReturnValues: 'NONE'
      };
      var dynamoDb = new aws.DynamoDB();
      dynamoDb.updateItem(params, function(err, data) {
        if(err) {
          return reject(err);
        }
        return resolve(result.item);
      });
    });
  }).then(function() {
    callback();
  }).catch(function(err) {
    logError(JSON.stringify(err));
    callback(err);
  })
};

exports.handleNotifications = function(event, context, callback) {
  logInfo('Handling notification: ' + JSON.stringify(event));
  var data = JSON.parse(event.Records[0].Sns.Message);
  if(
    data.notification_type === 'job_status' &&
    data.job_type === 'campaign_create' &&
    data.result.status === 'ready' &&
    data.status === 'finished'
  ) {
    return getLastItem()
      .then(function(item) {
        if(item.jobId === data.id) {
          var campaignId = data.result.id;
          logInfo('Job ' + data.id + ' finished');
          logInfo('Starting NASANEWS campaign: ' + campaignId);
          return portatext
            .campaignLifecycle()
            .id(campaignId)
            .start()
            .post()
        } else {
          logInfo('Not a NASANEWS job/campaign');
          return false;
        }
      }).then(function() {
        callback();
      }).catch(function(err) {
        logError(JSON.stringify(err));
        callback(err);
      });
  } else if(
    data.notification_type === "subscription" &&
    data.status === "opt_in" &&
    data.service_id === smsServiceId
  ) {
    logInfo(
      'Sending NASANEWS breaking news to new subscriber: ' + data.number
    );
    return getLastItem()
      .then(function(item) {
        return portatext
          .sms()
          .fromService(smsServiceId)
          .to(data.number)
          .useTemplate(templateId, {title: item.title, link: item.shortLink})
          .post()
      }).then(function() {
        callback();
      }).catch(function(err) {
        logError(JSON.stringify(err));
        callback(err);
      });
  } else {
    return callback();
  }
};

exports.fetch = function(event, context, callback) {
  download(feedUrl).
  then(function(rss) {
    return toStream(rss);
  }).then(function(stream) {
    return parse(stream);
  }).then(function(items) {
    return normalize(items);
  }).then(function(items) {
    return sort(items);
  }).then(function(items) {
    return pickLatest(items);
  }).then(function(item) {
    return shortenUrl(googleKey, item);
  }).then(function(item) {
    return saveItem(item);
  }).then(function(item) {
    if(item.jobId === null) {
      return notifyNewItem().then(function() {
        return item;
      });
    }
    return item;
  }).then(function() {
    callback();
  }).catch(function(err) {
    logError(err);
    callback(err);
  });
};

//exports.createCampaign(null, null, function(err) {
//  if(err) {
//    return logError(err);
//  }
//  console.log('a');
//});
//
//exports.fetch(null, null, function(err) {
//  if(err) {
//    return logError(err);
//  }
//  console.log('a');
//
//});