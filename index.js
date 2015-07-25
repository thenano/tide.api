var express = require('express')
  , cors = require('cors')
  , WolframClient = require('node-wolfram')
  , app = express();

var corsOptions = {
  origin: 'http://tide.is'
};

var client = new WolframClient(process.env.WOLFRAM_API_KEY);

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
  var match = stationText.match(/station \| (.+)\n.+\n.+position \| (\d+\.\d+ km)/);
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

app.get('/:lat/:lon', cors(corsOptions), function(req, res, next){
  client.query({
    input: 'tides | ' + req.params.lat + ' ' + req.params.lon,
    units: 'metric'
  }, function(err, result) {
    if(err) {
      res.status(400).send('Bad Request');
    } else {
      if (result.queryresult.pod) {
        res.json(parseResult(result.queryresult.pod));
      } else {
        res.json({tides: []});
      }
    }
  });
});

var port = process.env.PORT || 8080;
app.listen(port);