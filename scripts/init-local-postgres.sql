\set ON_ERROR_STOP on

-- Development-only role and database. Run this script as a PostgreSQL superuser.
SELECT 'CREATE ROLE dryvre LOGIN PASSWORD ''dryvre'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dryvre')
\gexec

SELECT 'CREATE DATABASE dryvre OWNER dryvre'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dryvre')
\gexec

ALTER DATABASE dryvre OWNER TO dryvre;
\connect dryvre

GRANT ALL PRIVILEGES ON DATABASE dryvre TO dryvre;
GRANT ALL ON SCHEMA public TO dryvre;
ALTER SCHEMA public OWNER TO dryvre;
