/**
 * A custom URL scheme (`pacto-example://...`) always works for the checkout
 * return link and needs no server-side setup — that's what `usePactoDeepLink`
 * defaults to. A `https://` **universal link** is nicer (it degrades to a
 * normal web page if the app isn't installed) but only routes to the app if
 * two verification files are hosted on the merchant's own domain, *and* the
 * native app declares the matching `associatedDomains` (iOS) /
 * `intentFilters` (Android) config — see `app.json` in `apps/example-rn` for
 * the native side. These builders produce the two files' JSON bodies; they
 * must be served from the merchant's own web origin at exactly
 * `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
 * — this package can't host them, since they live outside the mobile app
 * bundle entirely.
 */

export interface AppleAppSiteAssociationOptions {
  /** Apple Developer Team ID + bundle identifier, e.g. `"ABCDE12345.com.example.app"`. */
  appId: string;
  /** URL path patterns to hand off to the app. Defaults to `['/pacto-return*']`. */
  paths?: string[];
}

export interface AppleAppSiteAssociation {
  applinks: {
    details: Array<{ appIDs: string[]; components: Array<{ '/': string }> }>;
  };
}

/** Body for `/.well-known/apple-app-site-association` (no file extension, served as JSON). */
export function buildAppleAppSiteAssociation(
  options: AppleAppSiteAssociationOptions,
): AppleAppSiteAssociation {
  if (!options.appId) {
    throw new Error('[pacto-connect] appId is required');
  }

  const paths = options.paths && options.paths.length > 0 ? options.paths : ['/pacto-return*'];

  return {
    applinks: {
      details: [
        {
          appIDs: [options.appId],
          components: paths.map((path) => ({ '/': path })),
        },
      ],
    },
  };
}

export interface AndroidAssetLinksOptions {
  /** Application ID / package name, e.g. `"com.example.app"`. */
  packageName: string;
  /** SHA-256 certificate fingerprints (colon-separated hex) for every signing key used to build the app. */
  sha256CertFingerprints: string[];
}

export type AndroidAssetLinks = Array<{
  relation: string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}>;

/** Body for `/.well-known/assetlinks.json`. */
export function buildAndroidAssetLinks(options: AndroidAssetLinksOptions): AndroidAssetLinks {
  if (!options.packageName) {
    throw new Error('[pacto-connect] packageName is required');
  }
  if (options.sha256CertFingerprints.length === 0) {
    throw new Error('[pacto-connect] at least one sha256CertFingerprint is required');
  }

  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: options.packageName,
        sha256_cert_fingerprints: options.sha256CertFingerprints,
      },
    },
  ];
}
