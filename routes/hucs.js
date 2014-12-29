var express = require('express');
var router = express.Router();
var pg = require('pg');

var
  precision = 4,
  tolerance = 1.0;

router.get('/', function(req, res) {
  getHucs(req.body, res, req.query);
});

function getHucs(hucs, res, query) {
  console.log(query);
  var conString = 'pg://' + process.env.DB_USER + ':' + process.env.DB_PASS + '@localhost/ca_features';
  var client = new pg.Client(conString);
  client.connect();

  // Validations.
  // precision is the number of decimal places requested in the geometry: integer [0, 15].
  // If unspecified, defaults to 4;
  if (query.precision !== undefined || query.precision >= 0 || query.precision <= 15 ) {
    if (Number.isInteger(query.precision)) {
      precision = query.precision;
    } else {
      precision = Math.round(query.precision);
    }
  }
  // tolerance is a positive real number parameter given to ST_SimplifyPreserveTopology().
  // For SRID 4326, the unit is degrees.
  // see http://gis.stackexchange.com/questions/11910/meaning-of-simplifys-tolerance-parameter
  //
  if (parseFloat(query.tolerance) < 0.0) {
    tolerance = 100;
  }
  // bbox is the bounding box of the current Leaflet map viewport

  var fc = {
    "type": "FeatureCollection",
    "features": []
  };

  var sql;
  if (query.tolerance === undefined) {
    console.log('no tolerance supplied.');
    sql = 'SELECT huc_12, first_hu_1, hr_name, ' +
      'ST_AsGeoJSON(geom, ' + precision + ', 1) AS geometry ' +
      'FROM hucs ' +
      'WHERE ST_Intersects(ST_MakeEnvelope(' + query.bbox + ', 4326), geom);';
  } else {
    sql = 'SET search_path = "$user",public,topology;';
    client.query(sql);

    tolerance = parseFloat(query.tolerance);
    console.log('tolerance: ', tolerance);
    sql = 'SELECT huc_12, first_hu_1, hr_name, ' +
      'ST_AsGeoJSON(ST_Simplify(topogeom, ' + tolerance + '), ' + precision + ', 1) AS geometry ' +
      'FROM hucs ' +
      'WHERE ST_Intersects(ST_MakeEnvelope(' + query.bbox + ', 4326), geom);';
  }

  client.query(sql, function(err, result) {
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
    res.send(fc);
  });

}

module.exports = router;
