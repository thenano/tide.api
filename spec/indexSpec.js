var requestTester = require('request-tester');
var URL = 'https://tide-api.herokuapp.com';

describe('/ping endpoint', function () {
    it("should return pong", function (done) {
        requestTester.get(URL + '/ping')
            .expectStatus(200)
            .send()
            .then(done);
    });
});
