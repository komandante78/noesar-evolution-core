// SPDX-License-Identifier: AGPL-3.0-or-later
//
// /ca hands an unauthenticated caller a certificate that a device will then trust for every
// name inside it. src/trust-anchor.mjs argues why that is safe to publish; what makes it safe
// to POINT A DEVICE AT is narrower, and is asserted here: the file served is the one that
// actually signed the certificate this installation serves, and a file that did not is refused
// rather than published with a warning next to it.
//
// The fixtures are real certificates, generated once and embedded, so these assertions run
// against OpenSSL-produced DER rather than a hand-built approximation of it. Two independent
// authorities exist on purpose: the rejection case is the reason this module has a check at
// all, and it cannot be written with only one.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshTempDir } from './support/workspace.mjs';
import {
  resolveTrustAnchor, renderTrustAnchorIndex, MAX_TRUST_ANCHOR_BYTES,
  TRUST_ANCHOR_ROUTES, TRUST_ANCHOR_BASENAME,
} from '../src/trust-anchor.mjs';

// An authority, the leaf it issued, an unrelated authority that issued nothing here, and a
// self-signed certificate that terminates its own chain.
const CA_A = '-----BEGIN CERTIFICATE-----\nMIIDNzCCAh+gAwIBAgIUFTvJagyPNwYN1jpEnMdJNpDwhagwDQYJKoZIhvcNAQEL\nBQAwKjESMBAGA1UEAwwJVEVTVCBDQSBBMRQwEgYDVQQKDAtOT0VTQVIgVEVTVDAg\nFw0yNjA4MDkxNTIyMDVaGA8yMTI2MDcxNjE1MjIwNVowKjESMBAGA1UEAwwJVEVT\nVCBDQSBBMRQwEgYDVQQKDAtOT0VTQVIgVEVTVDCCASIwDQYJKoZIhvcNAQEBBQAD\nggEPADCCAQoCggEBAMNFqo649Qe1FdzxxXnHTTAcQO1XCtFcCY1erxdUIb6p13Bq\nLE9/fGERAu0+ozldBEIRRQ2kWzkSfiBxfgQyPkKH6RBVuSYVLS6vxvZLE6iDecvT\niwJibQr7YF1ahQp9fKXKJUgJEEn1UqTXFSDICtk1YgVQfED3DgcgSfsqn9AC9A1W\nSYopy/wjryPSvHxUiHCWRchgYkP5vC5v11cmxKVR7/z/dx2X0e75FwI9GnPkZI4P\nmgVM8QiJxUEvRXxjq4uVxgBOG80xHZ1+XD5fQWouWLGcWqn+Gbya6dOMV/lOz+od\nSCb8F+jrdY1f08GbBWHvRVE/UDhegjL2bjauhp0CAwEAAaNTMFEwHQYDVR0OBBYE\nFN5lBCYMt0aTN9jG6MOFU1P8+oAkMB8GA1UdIwQYMBaAFN5lBCYMt0aTN9jG6MOF\nU1P8+oAkMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAAowxNmT\nFRPY8QBB4QMZfmfhGxgR89BkNoLRjWm1N/jIqeLwdpzfF0OSCUmeKjjxtGY3dU05\nhBGxSltamk/SrreitRnrr2GvRqbxkkeI186ttM8MWWazd7fQkfVPR9ibPojKrrcP\nmYd/DAuz0F9xMFRIqcV2D9XW0XV97yI9+f+lkM5JCul2n6XqMKNKsjDpyoVSSa2k\ndqcUJDKcxnp0HmQUPoN8rPvhEs85Saahuj24tb/U373qVchNVxFYuOCXWLYyQBMS\nEcSm1mfYxKKxOCLbMraSQ3j5iktfMvqz3CXQIA0JVLAqBjgvquKilp7tnh28bNgL\nsNt11U4PyK9PGVU=\n-----END CERTIFICATE-----\n';
const CA_B = '-----BEGIN CERTIFICATE-----\nMIIDNzCCAh+gAwIBAgIUUotdvBhiejHOHGJj2m0KM7/VoPowDQYJKoZIhvcNAQEL\nBQAwKjESMBAGA1UEAwwJVEVTVCBDQSBCMRQwEgYDVQQKDAtOT0VTQVIgVEVTVDAg\nFw0yNjA4MDkxNTIyMDVaGA8yMTI2MDcxNjE1MjIwNVowKjESMBAGA1UEAwwJVEVT\nVCBDQSBCMRQwEgYDVQQKDAtOT0VTQVIgVEVTVDCCASIwDQYJKoZIhvcNAQEBBQAD\nggEPADCCAQoCggEBAN92KHx8QBiizELRmU4RJf4aFrL6iO9PkXjGKvBGa9IRrz6b\n+NR8SiyjqPkg6fNtTHDsrrpQANiseVlc4B45HpGyG0uCPNGtq0SQz+FyKnqJjuIx\nhNlfVr54/YIy8hPkiSuAX1njT35KbdRHNuA+3P8wOslQIuxWQ3TKPPDmPh9B/W8J\nx+UMeI0avfPQe1uANT84MiGI80V6Cou7/sYo7oCOkoLjg99uVJDx6/j13KSF1XHs\n9T6Ilojt/dVBfHDuSBgh8HJM+fq7nhjqySg2dLqsMpbY0oQ1EZDact2xFE8SZOs3\naECggMvOwgpabRU0VauwZoAwjuFE7/LhpDH0fikCAwEAAaNTMFEwHQYDVR0OBBYE\nFN1h5LUWpYLS1wRxkO9xlqjE/7TeMB8GA1UdIwQYMBaAFN1h5LUWpYLS1wRxkO9x\nlqjE/7TeMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBALWsRSu3\nntb/6mMoGkGOlSGmlSuRcGJFITF4At9A46jgMVlFb9GTAV2ZUjNW0PmQkRVhIQu2\nmY/m4FQ0HJ7gxfDLIcBQZIQHido0Bt7CMl0Gg+CG8+LP9L+GZZKXMfmUHQ8bCnMk\n1syHoFqc19H8d2xaPZ9G9ziS0LZRvoXeEeJK8UHrSLFe2VH3HSq2hvAsHoq5++ao\nqIm/ycjXya0vbdNGTQyrx/H1hQ78Mh4vek04bTTMUBHoZhoJqqmMZPt9O6ONxZHe\nVV0kt+tqJQUuFtF5XiRA9OOGqrQkTZd223j8kkwkoH5aj7wPhXAoj+e5DUrfOLaL\nOXsU1mQIoNVvopw=\n-----END CERTIFICATE-----\n';
const LEAF_FROM_A = '-----BEGIN CERTIFICATE-----\nMIIDSzCCAjOgAwIBAgIUSOWt9lvML67BMoVT4oi7ig2rCPMwDQYJKoZIhvcNAQEL\nBQAwKjESMBAGA1UEAwwJVEVTVCBDQSBBMRQwEgYDVQQKDAtOT0VTQVIgVEVTVDAg\nFw0yNjA4MDkxNTIyMDVaGA8yMTI2MDcxNjE1MjIwNVowLDEUMBIGA1UEAwwLbm9l\nc2FyLXRlc3QxFDASBgNVBAoMC05PRVNBUiBURVNUMIIBIjANBgkqhkiG9w0BAQEF\nAAOCAQ8AMIIBCgKCAQEA1fvYO+I0he/Fr2UDFNaNm41nh/Y1kf786MRrJ7qCPvMG\neIBVnJtaZv2NmqKh0+T8I+ttB0FlRGWBRbNfo1ploEcu5S0sXksdBRKnUiUbZkrE\nl6xFiQQZ1tc+7/8R4JXXU/wvCFrQGO6pc/eCRg87mpcvg2l4ggqIBA119ccFHHhX\nY9PW4urQfdPOB228we8mULARjg1u3AGtaMcdftF0u2vLVNb5liiIcRhhDMvHa4eP\nhGMlDcK3JCWVrURvuJYxDx2viR6HPVwc1PVV2c9Wo3yTT1UEKUnB00q85JQWsHRd\nroMn87/uEbN1vwG3cDoZF0HTBCclbh7xAbRkw1SKuQIDAQABo2UwYzAWBgNVHREE\nDzANggtub2VzYXItdGVzdDAJBgNVHRMEAjAAMB0GA1UdDgQWBBQ8WNzY2h9YuA74\naG/G7fxH3FbmUjAfBgNVHSMEGDAWgBTeZQQmDLdGkzfYxujDhVNT/PqAJDANBgkq\nhkiG9w0BAQsFAAOCAQEAkxBjkygqABk1zmnH80nIkNWs9NmebYSSgTloorJYlDZk\nPDLJ+LtNNmWF36tyY9Wl+D/4vWr7a9pV6XleQ3TZt3mgdjaCtHq/OaMwgx+ijuTC\nqB81ErGQLBRadjKPpEdsaTNv9hAT6ilnV0bXJwxB7ftzfgFfPCBsCuCoX9Dl5CoY\npcSHi5oDg/SkKt7nWyCSwrh9dqzdXmz8Zkl3cuqr0lIAS047CCZztouFZV72Jr3V\ngqIIeUaPd62FqTbNKaM4IHVoS42IYkpCGY4aMwXp4LN9pxiR7SfmfLbcI6KH1izZ\nbq13echfrWUfbUc43i/keSOUj+Vs1XBdVXKbi4jvOQ==\n-----END CERTIFICATE-----\n';
const SELF_SIGNED = '-----BEGIN CERTIFICATE-----\nMIIDZTCCAk2gAwIBAgIUAnz7IUi2HPrfOGg0nhJtkkd1UAUwDQYJKoZIhvcNAQEL\nBQAwMjEaMBgGA1UEAwwRbm9lc2FyLXNlbGZzaWduZWQxFDASBgNVBAoMC05PRVNB\nUiBURVNUMCAXDTI2MDgwOTE1MjIwNVoYDzIxMjYwNzE2MTUyMjA1WjAyMRowGAYD\nVQQDDBFub2VzYXItc2VsZnNpZ25lZDEUMBIGA1UECgwLTk9FU0FSIFRFU1QwggEi\nMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDPZM74htcjXoeTI91BmgYyW4aD\nPz3RSfualjnyLneBPjRGU5eC5gOtimvH/N1lj8oq2T6k/BxveHDP2Zx29/DdhJe7\nPKaD13treHmM8b/unoeiPbEYGva3DEJZz7z/o6CPL+TKYkzbsVLjGqixiMQ2TM1l\nPAWWkLEuLIe+Z1IVNtO23WzIFWXkxuhzsoJzPPQLlfJmkY5G2Ut9k87ZACgpr9Jd\njrAA3bYG3IZf9FUi5dKiXm6rkGDJt/lFhrvI3UjrCej5RS+4P21j9sVyB1uA1Bho\nrkMNMYhSPxiJWTQMExAvn2e0z6f6TR/jXqINSQhZL3wqM0Z+oUIRkE8vObOVAgMB\nAAGjcTBvMB0GA1UdDgQWBBRigWJVlKTDzAGB3YI7hzbciy22vDAfBgNVHSMEGDAW\ngBRigWJVlKTDzAGB3YI7hzbciy22vDAPBgNVHRMBAf8EBTADAQH/MBwGA1UdEQQV\nMBOCEW5vZXNhci1zZWxmc2lnbmVkMA0GCSqGSIb3DQEBCwUAA4IBAQBZy8DvHXBb\nVYv+s4jlwAVwDUTmS+jcalEqcSdGuviUYapE7Qd2+bkiB8FQSwZyZJa74anETX8r\nhmub42L28glKEyHZr+cfZw0zdbyOsw75r9kJlg+l6UvE4mfb5wK+bXzhIy+CBvd9\nMZQ19oybglVFF2vP29PTZVaKE3ybQLuFCqRazseLaGaDQb2vLKOIYHxlwungZ839\nGPd1UcTF+UZbjQCg2lX7tE5Zuzss2Go7NQiwmW3LslDpn8ylNCHkqC1b/WZdGcyw\noFyQTab8gjbb6q2nQr/hWg+aCMSUou0M9s9YPqJTPfB2HG+LPSVBJMQUso/hVpve\nZsWVyz2eLhbA\n-----END CERTIFICATE-----\n';

// A forged authority: same subject name as CA_A, same subjectKeyIdentifier, different key.
// Both of those are fields whoever builds the certificate simply writes, so copying them costs
// an attacker nothing — and OpenSSL's issued-by check compares exactly those. This fixture is
// what makes the signature check below load-bearing rather than decorative.
const CA_FORGED = '-----BEGIN CERTIFICATE-----\nMIIDNzCCAh+gAwIBAgIUF9ZxM5qPjAjn9/AGeyaPE7+ksLwwDQYJKoZIhvcNAQEL\nBQAwKjESMBAGA1UEAwwJVEVTVCBDQSBBMRQwEgYDVQQKDAtOT0VTQVIgVEVTVDAg\nFw0yNjA4MDkxNTI0MzNaGA8yMTI2MDcxNjE1MjQzM1owKjESMBAGA1UEAwwJVEVT\nVCBDQSBBMRQwEgYDVQQKDAtOT0VTQVIgVEVTVDCCASIwDQYJKoZIhvcNAQEBBQAD\nggEPADCCAQoCggEBAOzjXwrnzVx07xE1i+0j8CDTSkxbtzKxl0OgkaAMqSF/XHT9\nIu3V5QF7/fk2+nb+Y5TwX60nQVDCLfnmTJmKYYo8Dw0qlOUSG0FjKmRnSEeEwFZp\nbxoNOH8pkWvq+bW5j+shl1NIFHLfGvylbZFm2+Qj6iq/HkK7RVpG6c/YGTM+Bkkf\nkWw7Dwh1i7MD0smlkQrSrnsiQeqlfVoxHLfl5tMYPKZC++O0i9ym5yCqLn3Eh1D+\nJhXBjVwFyf0CZux6xZsc8UnALWCk1fe8xCXh3wiXOo2RNui61IMypU+emAjJmQgJ\nLOHqk8Y9mxmGX+zvvVSVo4Vhofhc+AXlTU5h9sUCAwEAAaNTMFEwHwYDVR0jBBgw\nFoAUZRsezY27UUj2qm/G2pNUl2jj28IwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E\nFgQU3mUEJgy3RpM32Mbow4VTU/z6gCQwDQYJKoZIhvcNAQELBQADggEBANE7esKi\n/vjaDn8Fdk4rGWlyrev24ELmTHNv2ZGmxqrhsdcxJFA/+XWgblEZzpfjZa2BSXWg\nTIPt2+kzGXnJlm+1L56BPxcy9HouPFEHuLn2xMWva3Xl4J9ls9Oz+bwglO72eCDm\nZ/fkn2SbYkylwiDCslleeCaT1sG/AShH575TncKyivgbJvjunJOc1IvBE/itScQT\nxz+8JH2h7dkgK5EG4aGNLj+4NhbYBXXvv3ou4Ma4VaQ6tg3mBHbskqy1kZ1F3/kz\nLrcVIM9qdZJW2zsJsRAiWLukDNzm2Hg9vByoU4kpGJWW9BdjE/WANCb7TwOxOKqg\nR/9EwyP11GxOAkU=\n-----END CERTIFICATE-----\n';

// The mirror image of CA_FORGED: the real authority's key, under a different name. The
// signature check accepts it — it is the same key — but a device builds a chain by NAME, so
// installing this one would trust an authority that never appears above this installation's
// certificate. The two checks in resolveTrustAnchor each catch exactly what the other misses.
const CA_WRONG_NAME = '-----BEGIN CERTIFICATE-----\nMIIDPzCCAiegAwIBAgIUHXdSDAmQAG6KxGCmv7KnthZKovYwDQYJKoZIhvcNAQEL\nBQAwLjEWMBQGA1UEAwwNU09NRUJPRFkgRUxTRTEUMBIGA1UECgwLTk9FU0FSIFRF\nU1QwIBcNMjYwODA5MTUyNTE2WhgPMjEyNjA3MTYxNTI1MTZaMC4xFjAUBgNVBAMM\nDVNPTUVCT0RZIEVMU0UxFDASBgNVBAoMC05PRVNBUiBURVNUMIIBIjANBgkqhkiG\n9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw0Wqjrj1B7UV3PHFecdNMBxA7VcK0VwJjV6v\nF1QhvqnXcGosT398YREC7T6jOV0EQhFFDaRbORJ+IHF+BDI+QofpEFW5JhUtLq/G\n9ksTqIN5y9OLAmJtCvtgXVqFCn18pcolSAkQSfVSpNcVIMgK2TViBVB8QPcOByBJ\n+yqf0AL0DVZJiinL/COvI9K8fFSIcJZFyGBiQ/m8Lm/XVybEpVHv/P93HZfR7vkX\nAj0ac+Rkjg+aBUzxCInFQS9FfGOri5XGAE4bzTEdnX5cPl9Bai5YsZxaqf4ZvJrp\n04xX+U7P6h1IJvwX6Ot1jV/TwZsFYe9FUT9QOF6CMvZuNq6GnQIDAQABo1MwUTAd\nBgNVHQ4EFgQU3mUEJgy3RpM32Mbow4VTU/z6gCQwHwYDVR0jBBgwFoAU3mUEJgy3\nRpM32Mbow4VTU/z6gCQwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOC\nAQEANJ50OG8/bzUOGT3CWS39dRjTeMAfOn2aPB4mTgTjmryRKbbq5t6vzU2gElOs\nfjf4PWRn5lgfdyyLQvqO73Dj9U6pmLsfxMi5TFTiDarJ0wjfZQG0qiZL9bZndDNq\nKsyP2SgOl5icvVpbP44/q6mWLWG+tbARustzv9Hv6MhUWuKZrf85teVjTKo7OBQ4\nxgFXG7jzy0cZzbh0tWA8thszpeoOOdtQQK3CrppEFiONhUxQ01qYW8X8M0JI2M+/\nJG6oRp8KKM9kziCTTcWEndtWFfjOsZPg6KGek1aG5bNm87D4/Fnqyr3O8x77XQr3\nReK5uW7ZsN+2OUbH3SP5hGWTdQ==\n-----END CERTIFICATE-----\n';

// Certificates that name THEMSELVES as issuer while being signed by a different key: the
// only shape that could reach the signature half of the self-signed branch. Built three ways
// (CA:FALSE, CA:TRUE, and with the key identifiers forced to line up) because each is rejected
// for a different reason inside OpenSSL.
const SELF_ISSUED_FOREIGN_SIGNED = ['-----BEGIN CERTIFICATE-----\nMIIDTTCCAjWgAwIBAgIUCzG5aC6kMpE9we06qapRtBp1migwDQYJKoZIhvcNAQEL\nBQAwLDEUMBIGA1UEAwwLbm9lc2FyLWxpYXIxFDASBgNVBAoMC05PRVNBUiBURVNU\nMCAXDTI2MDgwOTE1MjYyOVoYDzIxMjYwNzE2MTUyNjI5WjAsMRQwEgYDVQQDDAtu\nb2VzYXItbGlhcjEUMBIGA1UECgwLTk9FU0FSIFRFU1QwggEiMA0GCSqGSIb3DQEB\nAQUAA4IBDwAwggEKAoIBAQDku6dDARKtSMq3rthxb1vUs97vvRiMIlU/RoVBlYUe\nfLcfVLxtfLkEpRuDGMoYcvIOxWYNympCXSW1uUGHjRWy8w6B3jCSPHDgo5+BwjbO\n0Auj/dHnw9jvxMlwZIMWOvP4azV/JBRlkN6PRdhBQtDkMOsNhJ/rvdOJR3gGF3qS\nAOEQS8tXLQXBB8+9blDXfD+xgpTE7kI6+BeoVe/AsP4xrIO/gmK1S20XsEvoh4Gf\nE1WME9HdKz/qve+VZbFehWoO2H5D5qQ/6ThKWgq8ivLmIJ0XM+cSIe22flSilw5m\njb7XA5thNZ3PXSvLL2fZFHivTBaHmfSj0BCawrg9O+RzAgMBAAGjZTBjMBYGA1Ud\nEQQPMA2CC25vZXNhci1saWFyMAkGA1UdEwQCMAAwHQYDVR0OBBYEFE35o2G1ZbFb\n6GBwQL9dAPrAlPGbMB8GA1UdIwQYMBaAFDCCd3uyQ2IeEO9/lfL/2yIdi1KOMA0G\nCSqGSIb3DQEBCwUAA4IBAQBFYycHy1tCPvySeVy1r3bfLjCmIkyxIepzCJgreAL8\nJHoiybLF/qYqXb6884bDz0cbxytue6OaTAWGhx6KTJbSepjn8Siye7WRJUgATRgY\nhKQodK8RfO8Wb5d1IimVYRON8vzGrlTC2ZZEDNnzY2DapIYP8RKNjwVLrzMGIrzI\njcmKF/tduWJU4MReTtcL+MsnXf2aRvr9kjK8Hh+9AZ/TKPSwo3tPFySy6gNDOi+T\niwX5xRkWtgW7Hau5E1k5rvARAsEb1Q8u/VfL6PyL5AnoZC7bZVy0vkW6AvmD7g91\ndVE01JOCBvJxQ/J74J7uIs3zOfZgMsQm2cH4HvhNDGqo\n-----END CERTIFICATE-----\n', '-----BEGIN CERTIFICATE-----\nMIIDYzCCAkugAwIBAgIUCzG5aC6kMpE9we06qapRtBp1mikwDQYJKoZIhvcNAQEL\nBQAwLDEUMBIGA1UEAwwLbm9lc2FyLWxpYXIxFDASBgNVBAoMC05PRVNBUiBURVNU\nMCAXDTI2MDgwOTE1MjY0MFoYDzIxMjYwNzE2MTUyNjQwWjAsMRQwEgYDVQQDDAtu\nb2VzYXItbGlhcjEUMBIGA1UECgwLTk9FU0FSIFRFU1QwggEiMA0GCSqGSIb3DQEB\nAQUAA4IBDwAwggEKAoIBAQDku6dDARKtSMq3rthxb1vUs97vvRiMIlU/RoVBlYUe\nfLcfVLxtfLkEpRuDGMoYcvIOxWYNympCXSW1uUGHjRWy8w6B3jCSPHDgo5+BwjbO\n0Auj/dHnw9jvxMlwZIMWOvP4azV/JBRlkN6PRdhBQtDkMOsNhJ/rvdOJR3gGF3qS\nAOEQS8tXLQXBB8+9blDXfD+xgpTE7kI6+BeoVe/AsP4xrIO/gmK1S20XsEvoh4Gf\nE1WME9HdKz/qve+VZbFehWoO2H5D5qQ/6ThKWgq8ivLmIJ0XM+cSIe22flSilw5m\njb7XA5thNZ3PXSvLL2fZFHivTBaHmfSj0BCawrg9O+RzAgMBAAGjezB5MBYGA1Ud\nEQQPMA2CC25vZXNhci1saWFyMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQD\nAgKEMB0GA1UdDgQWBBRN+aNhtWWxW+hgcEC/XQD6wJTxmzAfBgNVHSMEGDAWgBQw\ngnd7skNiHhDvf5Xy/9siHYtSjjANBgkqhkiG9w0BAQsFAAOCAQEAEtUgd9A8+EBi\nVrBeeDr8b+KzWwVBqgd9Bqfn84/b8DL2JD70b4RwzFWouxUaDMUjcmN1NhQdGf6h\nte++ti7RB/lMKYLlUKdgt/VwpATGoPDySeXm2KNyRNXAV6WCZoHB22tA/0GkdSVv\npLHVdrV5hhrJ/sprmWxOwntM4bvrUhtQvtLBasKoPKSaYts+ABZ/OZ0VUsgwkBML\nGmWmOAxz/WyKdKCKwNfe3CB+7zcIRUInAoVo4VmErKGprn4BRDeFl5M/kQp/bel5\n2CvFVOFHn9gf5FmrP+K26j6ziSU8yXCfSWy3DtfFNtU6Sdm7P2uB02cOD4TkwqDt\nG0pdcZSizw==\n-----END CERTIFICATE-----\n', '-----BEGIN CERTIFICATE-----\nMIIDYzCCAkugAwIBAgIUCzG5aC6kMpE9we06qapRtBp1miowDQYJKoZIhvcNAQEL\nBQAwLDEUMBIGA1UEAwwLbm9lc2FyLWxpYXIxFDASBgNVBAoMC05PRVNBUiBURVNU\nMCAXDTI2MDgwOTE1MjcwNVoYDzIxMjYwNzE2MTUyNzA1WjAsMRQwEgYDVQQDDAtu\nb2VzYXItbGlhcjEUMBIGA1UECgwLTk9FU0FSIFRFU1QwggEiMA0GCSqGSIb3DQEB\nAQUAA4IBDwAwggEKAoIBAQDku6dDARKtSMq3rthxb1vUs97vvRiMIlU/RoVBlYUe\nfLcfVLxtfLkEpRuDGMoYcvIOxWYNympCXSW1uUGHjRWy8w6B3jCSPHDgo5+BwjbO\n0Auj/dHnw9jvxMlwZIMWOvP4azV/JBRlkN6PRdhBQtDkMOsNhJ/rvdOJR3gGF3qS\nAOEQS8tXLQXBB8+9blDXfD+xgpTE7kI6+BeoVe/AsP4xrIO/gmK1S20XsEvoh4Gf\nE1WME9HdKz/qve+VZbFehWoO2H5D5qQ/6ThKWgq8ivLmIJ0XM+cSIe22flSilw5m\njb7XA5thNZ3PXSvLL2fZFHivTBaHmfSj0BCawrg9O+RzAgMBAAGjezB5MBYGA1Ud\nEQQPMA2CC25vZXNhci1saWFyMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQD\nAgIEMB0GA1UdDgQWBBRN+aNhtWWxW+hgcEC/XQD6wJTxmzAfBgNVHSMEGDAWgBQw\ngnd7skNiHhDvf5Xy/9siHYtSjjANBgkqhkiG9w0BAQsFAAOCAQEAS0yaLRgYc+Pk\nNPSDqCRkSVoucqxWmc/Ugw/GjBV0Tbz0jfPagv/p+fTsC+wM06ODqEEYrpbpHMmZ\nAWtb0enPPrK6tnBATn+V8Jt1VWxo7oAAFT6HJ3ygnUq2UV8EdtnzXP9tC5a7Bg0r\nlHRekZ2VhsRce5nZAL6WfN4lEAVl/PZ5pHceBDU0Aoa9kSaEQkslpXte45ubxPKm\nRrinXS3Sh9GMo8MNCrMliK1NB9WbGph67R4qli250TquN1sn+UTOrlSUq+FwfcTD\nUgU2Mx2l22BVuMykrkYq2suIPHMP3ABZXoI149rgOmvQJgO02GBwkI3M0Wr0C1aP\ngYL1grQ8VQ==\n-----END CERTIFICATE-----\n'];

const dir = freshTempDir('noesar-trust-anchor-');
const write = (name, contents) => {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
};
const CA_A_FILE = write('caA.crt', CA_A);
const CA_B_FILE = write('caB.crt', CA_B);

const activeTls = (cert) => ({ active: true, cert });

describe('what is published, and what is refused', () => {
  test('a CA that issued this installation certificate is published', () => {
    const anchor = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env: { NOESAR_TLS_CA_FILE: CA_A_FILE } });
    assert.equal(anchor.available, true);
    assert.equal(anchor.reason, null);
    // The bytes served are the AUTHORITY's, not the leaf's. Serving the leaf here would look
    // like it worked on the day it was installed and break at the first certificate renewal.
    assert.equal(anchor.pem.trim(), CA_A.trim());
    assert.ok(anchor.source.includes(CA_A_FILE));
  });

  test('a CA that did NOT issue it is refused, and the reason names the real issuer', () => {
    const anchor = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env: { NOESAR_TLS_CA_FILE: CA_B_FILE } });
    assert.equal(anchor.available, false);
    assert.equal(anchor.pem, null, 'a refused anchor must carry no bytes a caller could serve anyway');
    assert.match(anchor.reason, /did not issue/);
    assert.match(anchor.reason, /TEST CA A/, 'the operator needs to be told which authority the certificate actually names');
  });

  test('a forged authority that copies the name AND the key identifier is caught by the signature', () => {
    const forgedFile = write('caForged.crt', CA_FORGED);
    // Stated as an assertion rather than a comment: the name-based check IS fooled here. If a
    // future OpenSSL tightens this and the line goes false, the test fails and says so, instead
    // of quietly passing while the case it was written for stopped existing.
    assert.equal(
      new X509Certificate(LEAF_FROM_A).checkIssued(new X509Certificate(CA_FORGED)), true,
      'the premise of this test: copying the names is enough to satisfy the issued-by check',
    );
    const anchor = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env: { NOESAR_TLS_CA_FILE: forgedFile } });
    assert.equal(anchor.available, false, 'only the signature separates this from the real authority');
    assert.equal(anchor.pem, null);
    assert.match(anchor.reason, /did not issue/);
  });

  test('the real key under a different name is refused, because devices chain by name', () => {
    const wrongFile = write('caWrongName.crt', CA_WRONG_NAME);
    assert.equal(
      new X509Certificate(LEAF_FROM_A).verify(new X509Certificate(CA_WRONG_NAME).publicKey), true,
      'the premise of this test: the signature check alone accepts this certificate',
    );
    const anchor = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env: { NOESAR_TLS_CA_FILE: wrongFile } });
    assert.equal(anchor.available, false, 'only the name check separates this from the real authority');
    assert.equal(anchor.pem, null);
  });

  test('a self-signed certificate is its own anchor, with no second file to configure', () => {
    const anchor = resolveTrustAnchor({ tls: activeTls(SELF_SIGNED), env: {} });
    assert.equal(anchor.available, true);
    assert.equal(anchor.pem.trim(), SELF_SIGNED.trim());
    assert.match(anchor.source, /self-signed/);
  });

  test('a CA-issued certificate with no CA file says what to set, and does not fall back to the leaf', () => {
    const anchor = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env: {} });
    assert.equal(anchor.available, false);
    assert.equal(anchor.pem, null);
    assert.match(anchor.reason, /NOESAR_TLS_CA_FILE/);
  });

  test('plaintext installation: nothing to trust, and that is not an error', () => {
    const anchor = resolveTrustAnchor({ tls: { active: false, cert: null }, env: { NOESAR_TLS_CA_FILE: CA_A_FILE } });
    assert.equal(anchor.available, false);
    assert.match(anchor.reason, /plaintext/);
  });

  test('an empty environment variable is unset, not a path of length zero', () => {
    const anchor = resolveTrustAnchor({ tls: activeTls(SELF_SIGNED), env: { NOESAR_TLS_CA_FILE: '   ' } });
    assert.equal(anchor.available, true, 'whitespace must take the self-signed path, not attempt to read a file');
  });
});

describe('a bad configuration degrades this route and nothing else', () => {
  // The whole point of never throwing: resolveTls() crashes startup on a half-configured pair
  // because the alternative there is silent plaintext. Here the listener is already correct,
  // so the proportionate outcome is one unavailable route carrying a stated reason.
  const cases = [
    ['a path that does not exist', { NOESAR_TLS_CA_FILE: join(dir, 'absent.crt') }, /could not be read/],
    ['a file that is not PEM', { NOESAR_TLS_CA_FILE: write('garbage.crt', 'not a certificate') }, /not a PEM certificate/],
    ['an empty file', { NOESAR_TLS_CA_FILE: write('empty.crt', '') }, /outside the 1\.\./],
    ['a file past the size cap', { NOESAR_TLS_CA_FILE: write('huge.crt', 'x'.repeat(MAX_TRUST_ANCHOR_BYTES + 1)) }, /outside the 1\.\./],
  ];
  for (const [name, env, expected] of cases) {
    test(name, () => {
      let anchor;
      assert.doesNotThrow(() => { anchor = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env }); });
      assert.equal(anchor.available, false);
      assert.match(anchor.reason, expected);
    });
  }

  test('bytes carrying the PEM marker that are still not a certificate are reported, not thrown', () => {
    let anchor;
    assert.doesNotThrow(() => {
      anchor = resolveTrustAnchor({ tls: activeTls('-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----\n'), env: {} });
    });
    assert.equal(anchor.available, false);
    assert.match(anchor.reason, /could not be parsed/);
  });
});

describe('the two digests are different numbers, and are labelled as such', () => {
  // The trap the page exists to disarm: an operator comparing `sha256sum ca.crt` against the
  // fingerprint their phone displays sees two different values over the same certificate,
  // which is indistinguishable from being attacked.
  const anchor = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env: { NOESAR_TLS_CA_FILE: CA_A_FILE } });

  test('fileSha256 is the digest of the bytes served, byte for byte', () => {
    assert.equal(anchor.fileSha256, createHash('sha256').update(anchor.pem).digest('hex'));
  });

  test('fingerprintSha256 is the certificate fingerprint an operating system shows', () => {
    assert.equal(anchor.fingerprintSha256, new X509Certificate(CA_A).fingerprint256);
  });

  test('they are not the same value', () => {
    assert.notEqual(anchor.fingerprintSha256.replace(/:/g, '').toLowerCase(), anchor.fileSha256.toLowerCase());
  });

  test('the page shows the fingerprint, and tells the reader to compare it', () => {
    const page = renderTrustAnchorIndex(anchor, 'https://192.168.178.100:8443');
    assert.ok(page.includes(anchor.fingerprintSha256), 'the fingerprint must appear literally, not summarised');
    assert.match(page, /not optional/);
    // The comparison must name a source that is NOT the downloaded file. Reading that file
    // back confirms whatever was sent, which is exactly the substitution this step exists to
    // catch — the first revision of this page said `openssl x509 -in <the file>` and was
    // circular in precisely that way. It shipped, and it was found by reading the page as a
    // person would rather than by any assertion, which is why one exists now.
    assert.match(page, /\/workspace\/tls\/ca\.crt/, 'the verification command must read the server\'s own copy');
    assert.match(page, /trust-anchor\.published/, 'the start-up log is the other out-of-band source and must be named');
    // iOS installs and trusts in two separate places and the second is easy to miss; a page
    // that stops after "Install" leaves the reader believing they are done.
    assert.match(page, /Certificate Trust Settings/);
  });

  test('the page for an unavailable anchor states the reason and offers no bytes', () => {
    const absent = resolveTrustAnchor({ tls: activeTls(LEAF_FROM_A), env: { NOESAR_TLS_CA_FILE: CA_B_FILE } });
    const page = renderTrustAnchorIndex(absent, 'http://192.168.178.100:8100');
    assert.match(page, /nothing to install/i);
    assert.ok(page.includes(absent.reason));
    assert.ok(!page.includes('BEGIN CERTIFICATE'));
  });
});

describe('the route table is a constant', () => {
  test('every route is a literal this module wrote, and the filename appears in it', () => {
    assert.deepEqual([...TRUST_ANCHOR_ROUTES], ['/ca', '/ca/', '/ca.crt', '/ca.crt.sha256']);
    assert.equal(TRUST_ANCHOR_BASENAME, 'ca.crt');
    assert.ok(Object.isFrozen(TRUST_ANCHOR_ROUTES));
  });
});

describe('the premise under the self-signed branch', () => {
  // resolveTrustAnchor's self-signed branch checks names AND signature. The signature half has
  // no constructible counterexample: a certificate that satisfies checkIssued(itself) turns out
  // to always be signed by its own key. That is a property of OpenSSL, not of this product, so
  // it is asserted rather than assumed — the day it stops holding, the signature check becomes
  // load-bearing and untested, and this test is what says so out loud.
  for (const [index, pem] of SELF_ISSUED_FOREIGN_SIGNED.entries()) {
    test(`self-issued, foreign-signed certificate #${index + 1} never satisfies the name check`, () => {
      const certificate = new X509Certificate(pem);
      assert.equal(certificate.subject, certificate.issuer, 'the fixture must genuinely name itself as issuer');
      assert.equal(certificate.verify(certificate.publicKey), false, 'and must genuinely not be self-signed');
      assert.equal(
        certificate.checkIssued(certificate), false,
        'if this becomes true, the signature half of the self-signed branch is now reachable and needs its own test',
      );
      // The whole point: whichever half rejects it, it must not be published as an anchor.
      const anchor = resolveTrustAnchor({ tls: activeTls(pem), env: {} });
      assert.equal(anchor.available, false);
    });
  }
});
