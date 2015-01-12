var express = require('express');
var router = express.Router();
var pg = require('pg');
var topojson = require('topojson');

var
  precision = 4,
  tolerance,
  quantization = 4,
  simplification = 0.5,
  payload;

router.get('/', function(req, res) {
  var query = req.query;
  console.log(query);

  // Validations.
  // precision is the number of decimal places requested in the geometry: integer [0, 15].
  if (query.p !== undefined && !isNaN(query.p) && query.p >= 0 && query.p <= 15) {
    precision = Math.round(query.p);
  }

  // tolerance is a positive real number parameter given to ST_SimplifyPreserveTopology().
  // For SRID 4326, the unit is meters.
  // see http://gis.stackexchange.com/questions/11910/meaning-of-simplifys-tolerance-parameter
  if (query.t !== undefined && !isNaN(query.t) && query.t >= 0 ) {
    tolerance = query.t;
  }

  // tolerance is a positive real number parameter given to ST_SimplifyPreserveTopology().
  // For SRID 4326, the unit is meters.
  // see http://gis.stackexchange.com/questions/11910/meaning-of-simplifys-tolerance-parameter
  if (query.q !== undefined && !isNaN(query.q) && query.q >= 0 ) {
    quantization = query.q;
  }

  // validateBbox (the bounding box of the current Leaflet map viewport)

  var conString = 'postgres://' + process.env.DB_USER + ':' + process.env.DB_PASS + '@localhost/ca_features';
  pg.connect(conString, function(err, client, done) {
    if(err) {
      return console.error('error fetching client from pool', err);
    }

    var sql;
    if (tolerance === undefined) {
      sql = 'SELECT huc_12, first_hu_1, hr_name, ' +
        'ST_AsGeoJSON(geom, ' + precision + ', 1) AS geometry ' +
        'FROM hucs ' +
        'WHERE ST_Intersects(ST_MakeEnvelope(' + query.bbox + ', 4326), geom);';
    } else {
      sql = 'SET search_path = "$user",public,topology;';
      client.query(sql, function(err, result) {
        done();
        if(err) {
          return console.error('error setting search path', err);
        }
      });

      sql = 'SELECT huc_12, first_hu_1, hr_name, ' +
        'ST_AsGeoJSON(ST_Simplify(topogeom, ' + tolerance + '), ' + precision + ', 1) AS geometry ' +
        'FROM hucs ' +
        'WHERE ST_Intersects(ST_MakeEnvelope(' + query.bbox + ', 4326), geom);';
    }

    var fc = {
      "type": "FeatureCollection",
      "features": []
    };

    client.query(sql, function(err, result) {
      done();

      if(err) {
        return console.error('error running query', err);
      }

      result.rows.forEach(function(feature){
        var f = {
          "type": "Feature",
          "geometry": JSON.parse(feature.geometry),
          "properties": {
            "huc_12": feature.huc_12,
            "first_hu_1": feature.first_hu_1,
            "hr_name": feature.hr_name
          }
        };
        fc.features.push(f);
      });

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.type('application/json');
      if (query.f === 'topojson') {
        payload = topojson.topology({ collection: fc}, { 'property-transform': function (feature) { return feature.properties }});
      } else {
        payload = fc;
      }
      // res.setHeader('Content-Length', new Buffer(payload).length);
      res.send(payload);
    });

  });

});

module.exports = router;
