## Loading HUCs into ca_features database:

```
$ shp2pgsql -I -s 3310:4326 AU_CA.shp hucs | psql -d ca_features
$ psql ca_features
ca_features=# alter table hucs drop constraint hucs_pkey;
ca_features=# alter table hucs add primary key (huc_12);
```

## pg_dump and copy with topology

```
pg_dump --host=localhost --create --no-owner --schema=topology --schema=hucs_topo --schema=public --file=wkg/ca_features-YYYYMMDD.sql ca_features
scp -i ~/.ssh/freshwaterspecies-aws-ncal.pem wkg/ca_features-YYYYMMDD.sql ubuntu@ec2-184-72-5-23.us-west-1.compute.amazonaws.com:/home/sites/ca-features-server/wkg
```

## Simplifying a map layer using PostGIS topology

From http://strk.keybit.net/blog/2012/04/13/simplifying-a-map-layer-using-postgis-topology/

```
-- Create a topology
SELECT CreateTopology('hucs_topo', find_srid('public', 'hucs', 'geom'));

-- Add a layer
SELECT AddTopoGeometryColumn('hucs_topo', 'public', 'hucs', 'topogeom', 'MULTIPOLYGON');

-- Populate the layer and the topology
UPDATE hucs SET topogeom = toTopoGeom(geom, 'hucs_topo', 1); -- 8.75 seconds

-- Simplify all edges up to 0.001 units
SELECT SimplifyEdgeGeom('hucs_topo', edge_id, 0.001) FROM hucs_topo.edge; -- 3.86 seconds

-- Convert the TopoGeometries to Geometries for visualization
ALTER TABLE hucs ADD geomsimp GEOMETRY;
UPDATE hucs SET geomsimp = topogeom::geometry; -- 0.11 seconds
```

```
CREATE OR REPLACE FUNCTION SimplifyEdgeGeom(atopo varchar, anedge int, maxtolerance float8)
RETURNS float8 AS $$
DECLARE
  tol float8;
  sql varchar;
BEGIN
  tol := maxtolerance;
  LOOP
    sql := 'SELECT topology.ST_ChangeEdgeGeom(' || quote_literal(atopo) || ', ' || anedge
      || ', ST_Simplify(geom, ' || tol || ')) FROM '
      || quote_ident(atopo) || '.edge WHERE edge_id = ' || anedge;
    BEGIN
      RAISE DEBUG 'Running %', sql;
      EXECUTE sql;
      RETURN tol;
    EXCEPTION
     WHEN OTHERS THEN
      RAISE WARNING 'Simplification of edge % with tolerance % failed: %', anedge, tol, SQLERRM;
      tol := round( (tol/2.0) * 1e8 ) / 1e8; -- round to get to zero quicker
      IF tol = 0 THEN RAISE EXCEPTION '%', SQLERRM; END IF;
    END;
  END LOOP;
END
$$ LANGUAGE 'plpgsql' STABLE STRICT;
```


## Creating tables to hold simplified HUC geometry" #FAIL

From http://trac.osgeo.org/postgis/wiki/UsersWikiSimplifyWithTopologyExt

1. Creates the target table that will contain simplified geometry. Initial huc multipolygons are dumped to handle simple
objects.

Do this for `hucs_1`, `hucs_01`, `hucs_001`, `hucs_0001`. Make a loop?

```
create table hucs_1 as (
       select huc_12, first_huc8, first_hu_1, hr_name, geom
       from hucs
);
alter table hucs_1 add primary key (huc_12);
create index hucs_1_geom_gist on hucs_1 using gist(geom);

-- adds the new geom column that will contain simplified geoms
alter table hucs_1 add column simple_geom geometry(MULTIPOLYGON, 4326);
```

2. Creates a topology from the hucs

```
-- create new empty topology structure
select topology.CreateTopology('topo1', 4326, 0);

-- add all hucs multipolygons to topology in one operation as a collection
select topology.ST_CreateTopoGeo('topo1',ST_Collect(geom))
from hucs;
```

3. Create a new topology based on the simplification of existing one. (should not be the right way to do it, but calling
ST_ChangeEdgeGeom)


```
select topology.CreateTopology('topo2', 4326, 0);

select topology.ST_CreateTopoGeo('topo2', geom)
from (
       select ST_Collect(st_simplifyPreserveTopology(geom, 1)) as geom
       from topo1.edge_data
) as foo;
```

4. Retrieves polygons by comparing surfaces (pip is not enough for odd-shaped polygons)

```
with simple_face as (
       select st_getFaceGeometry('topo2', face_id) as geom
       from topo2.face
       where face_id > 0
) update hucs_1 d set simple_geom = sf.geom
from simple_face sf
where st_intersects(d.geom, sf.geom)
and st_area(st_intersection(sf.geom, d.geom))/st_area(sf.geom) > 0.5;
```


### Intersects query

```
select huc_12, first_hu_1 from hucs where ST_Intersects(ST_MakeEnvelope(-123.0137, 37.6040, -122.3549, 37.8324, 4326), geom);
```

