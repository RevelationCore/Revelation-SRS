-- Create the schema that Keycloak expects.
-- PostgreSQL Docker entrypoint runs scripts in /docker-entrypoint-initdb.d
-- only on first initialisation of an empty data directory.

CREATE SCHEMA IF NOT EXISTS keycloak AUTHORIZATION srs;
