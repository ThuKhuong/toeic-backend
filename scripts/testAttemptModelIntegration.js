// Requires the real Python LightGBM service on 127.0.0.1:8000.
// Database fixture writes use the isolated schema of the Part 7 integration test.
process.env.TEST_REAL_MODEL='1';
require('./testPart7ReviewIntegration');
