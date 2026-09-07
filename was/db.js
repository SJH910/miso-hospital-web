const mysql = require("mysql2/promise");
const config = require("./config");

// 커넥션 풀 하나를 앱 전체에서 재사용 (요청마다 새로 열지 않음)
const pool = mysql.createPool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  database: config.dbName,
});

module.exports = pool;
