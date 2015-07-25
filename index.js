require('newrelic');

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

app.get('/:lat/:lon', cors(corsOptions), function(req, res, next){
  tideQuery(req.params.lat + ' ' + req.params.lon).then(function(result) {
    if (result.queryresult.pod.length < 2)
      throw new TideStationNotFoundException();
    
    res.json(parseResult(result.queryresult.pod));
  }).catch(TideStationNotFoundException, function (error) {
    console.log('---- havent found any stations, querying cities');
    var cities = [];

    return client.queryAsync({
      input: req.params.lat + ' ' + req.params.lon,
      units: 'metric',
      format: 'plaintext',
      includepodid: ['CartographicNearestCity', 'CartographicCities']
    }).then(function (response) {
      cities = _.flatten(response.queryresult.pod.reduce(function (cities, pod) {
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
          return res.json(result);
        }
      }

      return res.json({tides:[]});
    });
  }).catch(function (err) {
    console.log('Error during request', err);
    res.status(400).send('Bad Request');
  });
});

var port = process.env.PORT || 8080;
app.listen(port);