import os
import numpy as np
import re, time, calendar
from geopy import distance as geopy_distance
from datetime import datetime, timedelta
from subprocess import call
from scipy import signal

import falcon
import json
print os.environ.get('ALLOWED_ORIGINS', '')
ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', '').split(';')

class CorsMiddleware(object):

    def process_request(self, request, response):
        origin = request.get_header('Origin')
        if origin in ALLOWED_ORIGINS:
            response.set_header('Access-Control-Allow-Origin', origin)


class CoastFinder:
    def __init__(self):
        print('initializing known_coordinates')
        self.known_coordinates = np.memmap('coordinates.dat', mode='r+', shape=(3897607, 3), dtype=np.float)
        print('done')

    def find_nearest(self, coordinate):
        return np.sum(np.square(np.abs(self.known_coordinates[:,[0,1]]-coordinate)),1).argmin()

    def update_LAT(self, index, LAT):
        self.known_coordinates[index][2] = LAT


class TideExtremesCalculator:
    def find_extremes(self, coordinate, time, LAT):
        start = time = datetime.utcfromtimestamp(time) - timedelta(hours=13)
        contents = ''

        while (time < start + timedelta(hours=26)):
            time += timedelta(minutes=1)
            contents += '   {0:.3f}   {1:.3f}   {2:04d}   {3:02d}   {4:02d}   {5:02d}   {6:02d}   0\n'.format(coordinate[0], coordinate[1], time.year, time.month, time.day, time.hour, time.minute)

        tides_and_times = self.run_tide_algorithm(contents)
        return self.find_high_tides(tides_and_times, LAT) + self.find_low_tides(tides_and_times, LAT)

    def run_tide_algorithm(self, input_contents):
        lat_lon_time_file = open('OTPS2/tide_is_lat_lon_time', 'w')
        lat_lon_time_file.write(input_contents)
        lat_lon_time_file.close()

        call("./predict_tide", stdin=file("OTPS2/tide.is.inp"), cwd="OTPS2")

        tide_file = open('OTPS2/tide.is.out', 'r')
        tide_data = tide_file.read()
        tide_file.close()

        return np.array(re.findall(r"\s+-?\d+\.\d+\s+-?\d+\.\d+\s+(\d\d\.\d\d\.\d{4}\s\d\d:\d\d:\d\d)\s+(-?\d+\.\d+).*\n", tide_data),
            dtype=[('time', 'S19'), ('height', np.float)])
       
    def find_tide_maxima(self, maxima_range, tides_and_times, type, LAT):
        extremes = [];
        current_index = 0
        for i in np.append(np.where(maxima_range[1:] - maxima_range[:-1] > 1), maxima_range.size):
            local_maxima_range = maxima_range[current_index:i+1]
            current_index = i+1
            if not (local_maxima_range.size == 1 and (local_maxima_range[0] == 0 or local_maxima_range[0] == tides_and_times.size - 1)):
                index = int(np.average(local_maxima_range))
                posix_time = calendar.timegm(time.strptime(tides_and_times[index]['time'], '%m.%d.%Y %H:%M:%S'))
                extremes.append({
                    'time': posix_time,
                    'height': '%.1f' % (tides_and_times[index]['height'] + LAT),
                    'type': type
                })

        return extremes

    def find_high_tides(self, tides_and_times, LAT):
        high_tide_indexes = signal.argrelextrema(tides_and_times['height'], np.greater_equal, order=1440/3)[0]
        return self.find_tide_maxima(high_tide_indexes, tides_and_times, 'high', LAT)

    def find_low_tides(self, tides_and_times, LAT):
        high_tide_indexes = signal.argrelextrema(tides_and_times['height'], np.less_equal, order=1440/3)[0]
        return self.find_tide_maxima(high_tide_indexes, tides_and_times, 'low', LAT)

    def find_LAT(self, coordinate):
        start = time = datetime(datetime.today().year, 1, 1, 0, 0)
        file_contents = ''

        while (time < start + timedelta(days=19*365)):
            time += timedelta(hours=2)
            file_contents += '   {0:.3f}   {1:.3f}   {2:04d}   {3:02d}   {4:02d}   {5:02d}   {6:02d}   0\n'.format(coordinate[0], coordinate[1], time.year, time.month, time.day, time.hour, time.minute)

        return np.abs(np.sort(self.run_tide_algorithm(file_contents), order='height')[0]['height'])


class TideResource:
    def __init__(self):
        self.coast_finder = CoastFinder();
        self.tide_calculator = TideExtremesCalculator();

    def on_get(self, req, resp):
        lat = req.params['lat']
        lon = req.params['lon']
        time = req.params['time']
        request_coordinate = [float(lon), float(lat)]
        nearest_coordinate_index = self.coast_finder.find_nearest(request_coordinate)
        [nearest_coast_lon, nearest_coast_lat, LAT] = self.coast_finder.known_coordinates[nearest_coordinate_index]
        nearest_coordinate = (nearest_coast_lat, nearest_coast_lon)

        if not LAT:
            LAT = self.tide_calculator.find_LAT(nearest_coordinate)
            self.coast_finder.update_LAT(nearest_coordinate_index, LAT)

        body = {
            'location': {
                'coordinate': nearest_coordinate,
                'distance': geopy_distance.distance((lat, lon), nearest_coordinate).kilometers
            },
            'extremes': self.tide_calculator.find_extremes(nearest_coordinate, float(time), LAT)
        }

        resp.body = json.dumps(body)



api = application = falcon.API(middleware=[CorsMiddleware()])
api.add_route('/', TideResource())

