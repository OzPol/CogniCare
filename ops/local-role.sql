CREATE ROLE cognicare_app LOGIN PASSWORD 'cognicare_local_app';
ALTER ROLE cognicare_app SET statement_timeout = '8s';
ALTER ROLE cognicare_app SET idle_in_transaction_session_timeout = '10s';
