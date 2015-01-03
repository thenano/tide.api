var express = require('express')
  , cors = require('cors')
  , WolframClient = require('node-wolfram')
  , app = express();

var corsOptions = {
  origin: 'http://tide.is'
};

var client = new WolframClient(process.env.WOLFRAM_API_KEY);

var parseResult = function (response) {
  return response.reduce(function (result, pod) {
    if (pod.$.id === "Result") {
      result.data = pod.subpod[0].plaintext[0]
    };
    if (pod.$.id === "TideMeasurementStation") {
      result.station = pod.subpod[0].plaintext[0]
    };
    return result
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
      res.json(parseResult(result.queryresult.pod));
    }
  });
});

var port = process.env.PORT || 8080;
app.listen(port);