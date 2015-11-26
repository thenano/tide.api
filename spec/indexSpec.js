var requestTester = require('request-tester');
var URL = 'https://tide-api.herokuapp.com';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

describe('/ping endpoint', function () {
  it('should return pong', function (done) {
    requestTester.get(URL + '/ping')
      .expectStatus(200)
      .send()
      .then(done);
  });
});

describe('/{lat}E/{lon}N endponit', function () {
	describe('when no tide station nearby', function () {
		it('should return empty', function (done) {
			requestTester.get(URL + '/23.98E/11.45N')
        .expectStatus(200)
        .expectHeaderContains('content-type', 'application/json')
        .expectJSON({
          tides: []
        })
        .send()
        .then(done);
		});
  });

  describe('when there is a tide station', function () {
    it('should return tides and the tide station with the distance', function (done) {
      requestTester.get(URL + '/18.45E/-34.09N')
        .expectStatus(200)
        .expectHeaderContains('content-type', 'application/json')
        .expectJSON({
          tides: jasmine.any(Array),
          station: { 
            location: "Simon's Town",
            distance: '10.5km' 
          },
          rawData: jasmine.any(String)
        })
        .send()
        .then(done);
    });
	});

});
