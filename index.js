var express = require('express')
  , cors = require('cors')
  , Wolfram = require('node-wolfram')
  , app = express();

var corsOptions = {
  origin: 'http://tide.is'
};

var alphaClient = new Wolfram(process.env.WOLFRAM_API_KEY);

app.get('/:lat/:lon', cors(corsOptions), function(req, res, next){
  alphaClient.query("tides " + req.params.lat + " " + req.params.lon, function(err, result) {
  	if(err) {
  	  res.status(400).send('Bad Request');
  	} else {
  	  res.json(result);
  	}
  });
});

var port = process.env.PORT || 8080;
app.listen(port);