# 1 - Start the PostgreSQL Service

Start the PostgreSQL Service: You need to start the PostgreSQL server. You can start it manually every time you need it, or set it to start automatically at login.

To start PostgreSQL manually:

    brew services start postgresql@16

# 2 - Verify the Installation

Verify the Installation: To check if PostgreSQL is running and ready to accept connections, you can use:

    pg_isready

# 3 - Access the PostgreSQL Prompt

Access the PostgreSQL Prompt: You can access the PostgreSQL command-line interface using psql. To connect to the default postgres database, run:

    psql postgres

# 4 - Exercise Images Storage

The exercise catalog images are stored in an R2 Cloudflare Bucket
