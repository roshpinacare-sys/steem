
'use strict';

const { getPool } = require('./pool');

async function getCalibrationParams(calibratorName = 'default') {
  const { rows } = await getPool().query(
    `SELECT param_a AS "A", param_b AS "B"
     FROM calibration_settings
     WHERE calibrator_name = $1`,
    [calibratorName]
  );
  if (rows.length === 0) return null;
  return { A: Number(rows[0].A), B: Number(rows[0].B) };
}

async function saveCalibrationParams(calibratorName, A, B) {
  await getPool().query(
    `INSERT INTO calibration_settings (calibrator_name, param_a, param_b)
     VALUES ($1, $2, $3)
     ON CONFLICT (calibrator_name) DO UPDATE SET
       param_a = EXCLUDED.param_a,
       param_b = EXCLUDED.param_b,
       updated_at = now()`,
    [calibratorName, A, B]
  );
}

module.exports = {
  getCalibrationParams,
  saveCalibrationParams,
};
