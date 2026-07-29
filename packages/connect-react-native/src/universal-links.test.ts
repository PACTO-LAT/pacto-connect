import { describe, expect, it } from 'vitest';
import { buildAndroidAssetLinks, buildAppleAppSiteAssociation } from './universal-links.js';

describe('buildAppleAppSiteAssociation', () => {
  it('builds a single applinks detail entry with the default path pattern', () => {
    expect(buildAppleAppSiteAssociation({ appId: 'TEAMID.com.example.app' })).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['TEAMID.com.example.app'],
            components: [{ '/': '/pacto-return*' }],
          },
        ],
      },
    });
  });

  it('honors custom paths', () => {
    const result = buildAppleAppSiteAssociation({
      appId: 'TEAMID.com.example.app',
      paths: ['/pacto-return*', '/pacto-return/subscribe*'],
    });
    expect(result.applinks.details[0]?.components).toEqual([
      { '/': '/pacto-return*' },
      { '/': '/pacto-return/subscribe*' },
    ]);
  });

  it('throws without an appId', () => {
    expect(() => buildAppleAppSiteAssociation({ appId: '' })).toThrow(/appId/);
  });
});

describe('buildAndroidAssetLinks', () => {
  it('builds a single delegate_permission entry', () => {
    expect(
      buildAndroidAssetLinks({
        packageName: 'com.example.app',
        sha256CertFingerprints: ['AA:BB:CC'],
      }),
    ).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.example.app',
          sha256_cert_fingerprints: ['AA:BB:CC'],
        },
      },
    ]);
  });

  it('throws without a packageName', () => {
    expect(() =>
      buildAndroidAssetLinks({ packageName: '', sha256CertFingerprints: ['AA:BB:CC'] }),
    ).toThrow(/packageName/);
  });

  it('throws without at least one fingerprint', () => {
    expect(() =>
      buildAndroidAssetLinks({ packageName: 'com.example.app', sha256CertFingerprints: [] }),
    ).toThrow(/sha256CertFingerprint/);
  });
});
