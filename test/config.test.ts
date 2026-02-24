import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.ts';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const TMP_CONFIG = join(import.meta.dir, 'fixtures', 'test-config.yaml');

function writeTmpConfig(content: string): void {
  writeFileSync(TMP_CONFIG, content, 'utf-8');
}

function removeTmpConfig(): void {
  try {
    unlinkSync(TMP_CONFIG);
  } catch {
    /* empty */
  }
}

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env['AIAPL_PORT'];
    delete process.env['AIAPL_HOST'];
  });

  afterEach(() => {
    removeTmpConfig();
    delete process.env['AIAPL_PORT'];
    delete process.env['AIAPL_HOST'];
  });

  test('从 config.yaml 加载配置返回正确值', () => {
    const config = loadConfig('./config.yaml');
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.maxPayloadSize).toBe('50mb');
    expect(config.processors.image.enabled).toBe(true);
    expect(config.processors.image.output.format).toBe('webp');
    expect(config.processors.image.output.quality).toBe(80);
    expect(config.processors.image.output.effort).toBe(4);
    expect(config.processors.image.resize.maxWidth).toBe(2048);
    expect(config.processors.image.resize.maxHeight).toBe(2048);
    expect(config.logging.level).toBe('info');
    expect(config.logging.format).toBe('json');
  });

  test('文件不存在时返回默认配置', () => {
    const config = loadConfig('./nonexistent-path-99999.yaml');
    expect(config.server.port).toBe(DEFAULT_CONFIG.server.port);
    expect(config.server.host).toBe(DEFAULT_CONFIG.server.host);
    expect(config.server.maxPayloadSize).toBe(DEFAULT_CONFIG.server.maxPayloadSize);
    expect(config.processors.image.output.quality).toBe(DEFAULT_CONFIG.processors.image.output.quality);
    expect(config.processors.image.output.effort).toBe(DEFAULT_CONFIG.processors.image.output.effort);
    expect(config.logging.level).toBe(DEFAULT_CONFIG.logging.level);
  });

  test('quality 超出范围 (200) 时抛出错误', () => {
    writeTmpConfig(`
server:
  port: 3000
  host: "0.0.0.0"
  maxPayloadSize: "50mb"
processors:
  image:
    enabled: true
    output:
      format: "webp"
      quality: 200
      effort: 4
    resize:
      maxWidth: 2048
      maxHeight: 2048
logging:
  level: "info"
  format: "json"
`);
    expect(() => loadConfig(TMP_CONFIG)).toThrow(/quality/);
  });

  test('effort 超出范围 (10) 时抛出错误', () => {
    writeTmpConfig(`
server:
  port: 3000
  host: "0.0.0.0"
  maxPayloadSize: "50mb"
processors:
  image:
    enabled: true
    output:
      format: "webp"
      quality: 80
      effort: 10
    resize:
      maxWidth: 2048
      maxHeight: 2048
logging:
  level: "info"
  format: "json"
`);
    expect(() => loadConfig(TMP_CONFIG)).toThrow(/effort/);
  });

  test('AIAPL_PORT 环境变量覆盖端口', () => {
    process.env['AIAPL_PORT'] = '8080';
    const config = loadConfig('./config.yaml');
    expect(config.server.port).toBe(8080);
  });

  test('AIAPL_HOST 环境变量覆盖主机', () => {
    process.env['AIAPL_HOST'] = '127.0.0.1';
    const config = loadConfig('./config.yaml');
    expect(config.server.host).toBe('127.0.0.1');
  });

  test('AIAPL_PORT 为非数字时抛出错误', () => {
    process.env['AIAPL_PORT'] = 'not-a-number';
    expect(() => loadConfig('./config.yaml')).toThrow(/AIAPL_PORT/);
  });

  test('端口为 0 时抛出错误', () => {
    writeTmpConfig(`
server:
  port: 0
  host: "0.0.0.0"
  maxPayloadSize: "50mb"
processors:
  image:
    enabled: true
    output:
      format: "webp"
      quality: 80
      effort: 4
    resize:
      maxWidth: 2048
      maxHeight: 2048
logging:
  level: "info"
  format: "json"
`);
    expect(() => loadConfig(TMP_CONFIG)).toThrow(/端口/);
  });

  test('端口为 99999 时抛出错误', () => {
    writeTmpConfig(`
server:
  port: 99999
  host: "0.0.0.0"
  maxPayloadSize: "50mb"
processors:
  image:
    enabled: true
    output:
      format: "webp"
      quality: 80
      effort: 4
    resize:
      maxWidth: 2048
      maxHeight: 2048
logging:
  level: "info"
  format: "json"
`);
    expect(() => loadConfig(TMP_CONFIG)).toThrow(/端口/);
  });

  test('maxPayloadSize 为空字符串时抛出错误', () => {
    writeTmpConfig(`
server:
  port: 3000
  host: "0.0.0.0"
  maxPayloadSize: ""
processors:
  image:
    enabled: true
    output:
      format: "webp"
      quality: 80
      effort: 4
    resize:
      maxWidth: 2048
      maxHeight: 2048
logging:
  level: "info"
  format: "json"
`);

    expect(() => loadConfig(TMP_CONFIG)).toThrow(/maxPayloadSize/);
  });

  test('非法 logging 值会回退到默认值', () => {
    writeTmpConfig(`
logging:
  level: "trace"
  format: "pretty"
`);

    const config = loadConfig(TMP_CONFIG);

    expect(config.logging.level).toBe('info');
    expect(config.logging.format).toBe('json');
  });
});
