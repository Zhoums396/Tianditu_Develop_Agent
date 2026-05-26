package com.tianditu.authbridge;

public final class AuthBridgeConfig {
  private final String mode;
  private final int port;
  private final String cookieName;
  private final String sharedSecret;
  private final long cookieMaxAgeSeconds;
  private final boolean cookieSecure;
  private final String cookieDomain;
  private final String sdkJarPath;
  private final String[] sdkExtraClasspathEntries;
  private final String sdkAccessKey;
  private final String sdkSecretKey;
  private final boolean sdkAutoDetectLocalDeps;
  private final AuthBridgeUser mockUser;

  private AuthBridgeConfig(
      String mode,
      int port,
      String cookieName,
      String sharedSecret,
      long cookieMaxAgeSeconds,
      boolean cookieSecure,
      String cookieDomain,
      String sdkJarPath,
      String[] sdkExtraClasspathEntries,
      String sdkAccessKey,
      String sdkSecretKey,
      boolean sdkAutoDetectLocalDeps,
      AuthBridgeUser mockUser
  ) {
    this.mode = mode;
    this.port = port;
    this.cookieName = cookieName;
    this.sharedSecret = sharedSecret;
    this.cookieMaxAgeSeconds = cookieMaxAgeSeconds;
    this.cookieSecure = cookieSecure;
    this.cookieDomain = cookieDomain;
    this.sdkJarPath = sdkJarPath;
    this.sdkExtraClasspathEntries = sdkExtraClasspathEntries;
    this.sdkAccessKey = sdkAccessKey;
    this.sdkSecretKey = sdkSecretKey;
    this.sdkAutoDetectLocalDeps = sdkAutoDetectLocalDeps;
    this.mockUser = mockUser;
  }

  public static AuthBridgeConfig fromEnv() {
    return new AuthBridgeConfig(
        readString("AUTH_BRIDGE_MODE", "mock"),
        parseInt("AUTH_BRIDGE_PORT", 8080),
        readString("AUTH_COOKIE_NAME", "tdt_auth"),
        readString("AUTH_SHARED_SECRET", "tdt-dev-shared-secret"),
        parseLong("AUTH_COOKIE_MAX_AGE_SECONDS", 21600L),
        parseBoolean("AUTH_COOKIE_SECURE", false),
        readString("AUTH_COOKIE_DOMAIN", ""),
        readOptionalString("AUTH_BRIDGE_SDK_JAR"),
        splitPathList(readOptionalString("AUTH_BRIDGE_SDK_EXTRA_CLASSPATH")),
        readOptionalString("AUTH_BRIDGE_ACCESS_KEY"),
        readOptionalString("AUTH_BRIDGE_SECRET_KEY"),
        parseBoolean("AUTH_BRIDGE_SDK_AUTO_DETECT_LOCAL_DEPS", true),
        new AuthBridgeUser(
            readString("AUTH_BRIDGE_MOCK_SUB", "tdt-dev-user"),
            readString("AUTH_BRIDGE_MOCK_LOGIN_NAME", "tdt.dev"),
            readString("AUTH_BRIDGE_MOCK_DISPLAY_NAME", "天地图开发用户"),
            readOptionalString("AUTH_BRIDGE_MOCK_EMAIL"),
            readOptionalString("AUTH_BRIDGE_MOCK_GBCODE"),
            readOptionalString("AUTH_BRIDGE_MOCK_COMPANY_NAME"),
            parseOptionalInt("AUTH_BRIDGE_MOCK_USER_TYPE")
        )
    );
  }

  public String getMode() {
    return mode;
  }

  public int getPort() {
    return port;
  }

  public String getCookieName() {
    return cookieName;
  }

  public String getSharedSecret() {
    return sharedSecret;
  }

  public long getCookieMaxAgeSeconds() {
    return cookieMaxAgeSeconds;
  }

  public boolean isCookieSecure() {
    return cookieSecure;
  }

  public String getCookieDomain() {
    return cookieDomain;
  }

  public String getSdkJarPath() {
    return sdkJarPath;
  }

  public String[] getSdkExtraClasspathEntries() {
    return sdkExtraClasspathEntries.clone();
  }

  public String getSdkAccessKey() {
    return sdkAccessKey;
  }

  public String getSdkSecretKey() {
    return sdkSecretKey;
  }

  public boolean isSdkAutoDetectLocalDeps() {
    return sdkAutoDetectLocalDeps;
  }

  public AuthBridgeUser getMockUser() {
    return mockUser;
  }

  private static String readString(String name, String defaultValue) {
    String value = System.getenv(name);
    if (value == null || value.trim().isEmpty()) {
      return defaultValue;
    }
    return value.trim();
  }

  private static String readOptionalString(String name) {
    String value = System.getenv(name);
    if (value == null || value.trim().isEmpty()) {
      return null;
    }
    return value.trim();
  }

  private static boolean parseBoolean(String name, boolean defaultValue) {
    String value = System.getenv(name);
    if (value == null || value.trim().isEmpty()) {
      return defaultValue;
    }
    String normalized = value.trim().toLowerCase();
    if ("1".equals(normalized) || "true".equals(normalized) || "yes".equals(normalized) || "on".equals(normalized)) {
      return true;
    }
    if ("0".equals(normalized) || "false".equals(normalized) || "no".equals(normalized) || "off".equals(normalized)) {
      return false;
    }
    return defaultValue;
  }

  private static int parseInt(String name, int defaultValue) {
    String value = System.getenv(name);
    if (value == null || value.trim().isEmpty()) {
      return defaultValue;
    }
    try {
      return Integer.parseInt(value.trim());
    } catch (NumberFormatException ex) {
      return defaultValue;
    }
  }

  private static long parseLong(String name, long defaultValue) {
    String value = System.getenv(name);
    if (value == null || value.trim().isEmpty()) {
      return defaultValue;
    }
    try {
      return Long.parseLong(value.trim());
    } catch (NumberFormatException ex) {
      return defaultValue;
    }
  }

  private static Integer parseOptionalInt(String name) {
    String value = System.getenv(name);
    if (value == null || value.trim().isEmpty()) {
      return null;
    }
    try {
      return Integer.valueOf(value.trim());
    } catch (NumberFormatException ex) {
      return null;
    }
  }

  private static String[] splitPathList(String raw) {
    if (raw == null || raw.trim().isEmpty()) {
      return new String[0];
    }
    return raw.split(FilePathSupport.pathSeparatorRegex());
  }
}
