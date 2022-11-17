# get-platonus-tests

Script gets tests from platonus. The platonus doesnt have option to download existing tests
To use script user nedds to setup `.env` file like this:

```
DATABASE_HOST="your-database-ip-address"
DATABASE_PORT="your-database-port"
DATABASE_USER="database-user"
DATABASE_PASSWORD="db_password123"
DATABASE_NAME="platonus_db_name"
```

Usage:
`node index.js <testid1> [<testid2> ...]`

Tests writes to file in Aiken format, if the user needs `<question><variant>` format, use flag `-p`
