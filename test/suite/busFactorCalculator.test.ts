import * as assert from 'assert';
import { getRiskLevel } from '../../src/core/busFactorCalculator';

suite('BusFactorCalculator', () => {
  test('getRiskLevel returns critical at threshold 1', () => {
    assert.strictEqual(getRiskLevel(1, 2, 1), 'critical');
    assert.strictEqual(getRiskLevel(0, 2, 1), 'critical');
  });

  test('getRiskLevel returns warning at threshold 2', () => {
    assert.strictEqual(getRiskLevel(2, 2, 1), 'warning');
  });

  test('getRiskLevel returns healthy above threshold', () => {
    assert.strictEqual(getRiskLevel(3, 2, 1), 'healthy');
    assert.strictEqual(getRiskLevel(10, 2, 1), 'healthy');
  });

  test('getRiskLevel handles equal critical and warning thresholds', () => {
    // If critical = warning = 1, bus factor of 1 → critical
    assert.strictEqual(getRiskLevel(1, 1, 1), 'critical');
    // bus factor 2 → healthy (above warning)
    assert.strictEqual(getRiskLevel(2, 1, 1), 'healthy');
  });

  test('getRiskLevel with custom thresholds', () => {
    assert.strictEqual(getRiskLevel(3, 5, 2), 'warning'); // 3 <= 5 but > 2
    assert.strictEqual(getRiskLevel(6, 5, 2), 'healthy');
  });
});
