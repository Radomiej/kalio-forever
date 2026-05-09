import { describe, it, expect } from 'vitest';
import { isPrivateUrl, isAllowedFilePath } from './native-security.utils';

describe('isPrivateUrl', () => {
  describe('blocks loopback addresses', () => {
    it('blocks localhost', () => expect(isPrivateUrl('http://localhost/path')).toBe(true));
    it('blocks 127.0.0.1', () => expect(isPrivateUrl('http://127.0.0.1')).toBe(true));
    it('blocks 127.0.0.2', () => expect(isPrivateUrl('http://127.0.0.2')).toBe(true));
    it('blocks 0.0.0.0', () => expect(isPrivateUrl('http://0.0.0.0')).toBe(true));
    it('blocks ::1', () => expect(isPrivateUrl('http://::1')).toBe(true));
    it('blocks [::1]', () => expect(isPrivateUrl('http://[::1]')).toBe(true));
  });

  describe('blocks RFC-1918 ranges', () => {
    it('blocks 10.x.x.x', () => expect(isPrivateUrl('http://10.0.0.1')).toBe(true));
    it('blocks 10.255.255.255', () => expect(isPrivateUrl('http://10.255.255.255')).toBe(true));
    it('blocks 172.16.0.1', () => expect(isPrivateUrl('http://172.16.0.1')).toBe(true));
    it('blocks 172.31.255.255', () => expect(isPrivateUrl('http://172.31.255.255')).toBe(true));
    it('allows 172.15.0.1 (outside 172.16-31 range)', () => expect(isPrivateUrl('http://172.15.0.1')).toBe(false));
    it('allows 172.32.0.1 (outside 172.16-31 range)', () => expect(isPrivateUrl('http://172.32.0.1')).toBe(false));
    it('blocks 192.168.0.1', () => expect(isPrivateUrl('http://192.168.0.1')).toBe(true));
    it('blocks 192.168.255.255', () => expect(isPrivateUrl('http://192.168.255.255')).toBe(true));
  });

  describe('blocks AWS metadata / link-local', () => {
    it('blocks 169.254.169.254 (AWS metadata)', () => expect(isPrivateUrl('http://169.254.169.254/latest/meta-data')).toBe(true));
    it('blocks 169.254.0.1', () => expect(isPrivateUrl('http://169.254.0.1')).toBe(true));
  });

  describe('blocks 0.x.x.x', () => {
    it('blocks 0.0.0.1', () => expect(isPrivateUrl('http://0.0.0.1')).toBe(true));
  });

  describe('blocks malformed URLs', () => {
    it('blocks empty string', () => expect(isPrivateUrl('')).toBe(true));
    it('blocks non-URL string', () => expect(isPrivateUrl('not-a-url')).toBe(true));
    it('blocks javascript: scheme', () => expect(isPrivateUrl('javascript:alert(1)')).toBe(true));
  });

  describe('allows public URLs', () => {
    it('allows example.com', () => expect(isPrivateUrl('https://example.com')).toBe(false));
    it('allows api.openai.com', () => expect(isPrivateUrl('https://api.openai.com/v1')).toBe(false));
    it('allows 8.8.8.8', () => expect(isPrivateUrl('http://8.8.8.8')).toBe(false));
    it('allows 1.1.1.1', () => expect(isPrivateUrl('https://1.1.1.1')).toBe(false));
    it('allows with port', () => expect(isPrivateUrl('https://example.com:443/path')).toBe(false));
  });

  // BUG CHECK: 172.32 should be allowed (not in 172.16-31 range)
  it('does NOT block 172.32.x.x — outside private range', () => {
    expect(isPrivateUrl('http://172.32.0.1')).toBe(false);
  });
});

describe('isAllowedFilePath', () => {
  it('allows a path under cwd', () => {
    const cwd = process.cwd();
    expect(isAllowedFilePath(cwd + '/some/file.txt')).toBe(true);
  });

  it('allows a path under homedir', () => {
    const os = require('os') as typeof import('os');
    expect(isAllowedFilePath(os.homedir() + '/documents/file.txt')).toBe(true);
  });

  it('blocks path traversal to root', () => {
    // Attempting to escape both home and cwd
    expect(isAllowedFilePath('/etc/passwd')).toBe(false);
  });

  it('blocks path outside both home and cwd', () => {
    expect(isAllowedFilePath('/tmp/malicious')).toBe(false);
  });
});
