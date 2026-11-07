-- psql -f db.sql: the database of the real-world benchmark.
--   world    10,000 rows, as in the TechEmpower benchmarks
--   fortune  the 12 TechEmpower fortunes
--   product  1,000,000 rows in 1,000 categories, which the servers load into
--            memory at startup for /search and /report
DROP TABLE IF EXISTS world, fortune, product;

CREATE TABLE world (
  id integer PRIMARY KEY,
  randomnumber integer NOT NULL
);
INSERT INTO world (id, randomnumber)
SELECT i, 1 + floor(random() * 10000)::integer FROM generate_series(1, 10000) AS i;

CREATE TABLE fortune (
  id integer PRIMARY KEY,
  message varchar(2048) NOT NULL
);
INSERT INTO fortune (id, message) VALUES
  (1, 'fortune: No such file or directory'),
  (2, 'A computer scientist is someone who fixes things that aren''t broken.'),
  (3, 'After enough decimal places, nobody gives a damn.'),
  (4, 'A bad random number generator: 1, 1, 1, 1, 1, 4.33e+67, 1, 1, 1'),
  (5, 'A computer program does what you tell it to do, not what you want it to do.'),
  (6, 'Emacs is a nice operating system, but I prefer UNIX. — Tom Christaensen'),
  (7, 'Any program that runs right is obsolete.'),
  (8, 'A list is only as strong as its weakest link. — Donald Knuth'),
  (9, 'Feature: A bug with seniority.'),
  (10, 'Computers make very fast, very accurate mistakes.'),
  (11, '<script>alert("This should not be displayed in a browser alert box.");</script>'),
  (12, 'フレームワークのベンチマーク');

CREATE TABLE product (
  id integer PRIMARY KEY,
  name text NOT NULL,
  category integer NOT NULL,
  price numeric(10, 2) NOT NULL,
  stock integer NOT NULL,
  rating double precision NOT NULL,
  brand text NOT NULL
);
INSERT INTO product (id, name, category, price, stock, rating, brand)
SELECT i,
       'product ' || i,
       i % 1000,
       ((i::bigint * 7919) % 100000) / 100.0,
       (i * 31) % 50,
       ((i * 13) % 50) / 10.0,
       'brand ' || ((i * 17) % 200)
FROM generate_series(0, 999999) AS i;

ANALYZE world, fortune, product;
