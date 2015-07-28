if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic');
}

var elasticsearch = require('elasticsearch');
var ESClient = new elasticsearch.Client({
    host: process.env.SEARCHBOX_SSL_URL
});

var express = require('express');
var cors = require('cors');
var WolframClient = require('node-wolfram');
var Promise = require("bluebird");
var _ = require('lodash');

var app = express();

var corsOptions = {
  origin: 'http://tide.is'
};

function TideStationNotFoundException() {}
TideStationNotFoundException.prototype = Object.create(Error.prototype);

var client = new WolframClient(process.env.WOLFRAM_API_KEY);
var clientQuery = Promise.promisifyAll(client);

var parseTides = function (tideText) {
  var tides = [];
  var parser = /(low|high) tide \| (\d+:\d+ (am|pm) \w+)(\n\(([^)]+)\))? \| (.\d+(\.\d+)?) meter/g;
  while ((match = parser.exec(tideText)) !== null) {
    tides.push({
      type: match[1],
      time: match[2],
      height: match[6],
      when: match[5]
    });
  }
  return tides;
};

var parseStation = function (stationText) {
  var match = stationText.match(/station \| (.+)\n.+\n.+position \| (\d+(\.\d+)? km)/);
  return {
    location: match[1],
    distance: match[2].replace(' ', '')
  };
};

var parseResult = function (response) {
  return response.reduce(function (result, pod) {
    if (pod.$.id === "Result") {
      result.tides = parseTides(pod.subpod[0].plaintext[0]);
      result.rawData = pod.subpod[0].plaintext[0]
    }
    if (pod.$.id === "TideMeasurementStation") {
      result.station = parseStation(pod.subpod[0].plaintext[0]);
    }
    return result;
  }, {});
};

var tideQuery = function (location) {
  return client.queryAsync({
    input: 'tides ' + location,
    units: 'metric',
    format: 'plaintext',
    includepodid: ['Result', 'TideMeasurementStation']
  });
};

var parseNearby = function (nearbyCityText) {
  var match = nearbyCityText.match(/([^(]+)\((\d+ km)/);
  if (match !== null) {
    return {
      name: match[1].trim(),
      distance: match[2].replace(' ', '')
    };
  }
  return [];
};

var parseCities = function (citiesText) {
  var cities = [];
  var parser = /([^|]+) \| (\d+ km).+(\n)?/g;
  while ((match = parser.exec(citiesText)) !== null) {
    cities.push({
      name: match[1],
      distance: match[2].replace(' ', '')
    });
  }
  return cities;
};

var indexEs = function (latitude, longitude, tideResult, cities) {
  var esDoc = {
    index: 'tide_api_calls',
    type: 'requestresponse',
    body: {
      geoJSON: [longitude, latitude],
      result: {}
    }
  };

  if (tideResult) {
    esDoc.body.result.station = tideResult.station;
  }

  if (cities) {
    esDoc.body.result.cities = cities;
  }

  ESClient.index(esDoc);
};

app.get('/:latitude/:longitude', cors(corsOptions), function(req, res, next){
  var latitude = req.params.latitude;
  var longitude = req.params.longitude;

  tideQuery(latitude + ' ' + longitude).then(function(tideResult) {
    if (tideResult.queryresult.pod.length < 2)
      throw new TideStationNotFoundException();
    
    var result = parseResult(tideResult.queryresult.pod);
    indexEs(latitude, longitude, result);
    res.json(result);
  }).catch(TideStationNotFoundException, function (error) {
    console.log('---- havent found any stations, querying cities');
    var cities = [];

    return client.queryAsync({
      input: latitude + ' ' + longitude,
      units: 'metric',
      format: 'plaintext',
      includepodid: ['CartographicNearestCity', 'CartographicCities']
    }).then(function (citiesResponse) {
      cities = _.flatten(citiesResponse.queryresult.pod.reduce(function (cities, pod) {
        if (pod.$.id === "CartographicNearestCity") {
          cities.push(parseNearby(pod.subpod[0].plaintext[0]));
        }
        if (pod.$.id === "CartographicCities") {
          cities.push(parseCities(pod.subpod[0].plaintext[0]));
        }
        return cities;
      }, []));

      return Promise.all(_.map(cities, function (city) {
        return tideQuery(city.name);
      }));
    }).then(function (tideResults) {
      for (var i = 0; i < tideResults.length; i++) {
        var tideResult = tideResults[i];
        if (tideResult.queryresult.pod && tideResult.queryresult.pod.length == 2) {
          var result = parseResult(tideResult.queryresult.pod);
          result.station.distance = cities[i].distance;
          indexEs(latitude, longitude, result, cities);
          return res.json(result);
        }
      }

      indexEs(latitude, longitude);
      return res.json({tides:[]});
    });
  }).catch(function (err) {
    console.log('Error during request', err);
    res.status(400).send('Bad Request');
  });
});

var port = process.env.PORT || 8080;
app.listen(port);