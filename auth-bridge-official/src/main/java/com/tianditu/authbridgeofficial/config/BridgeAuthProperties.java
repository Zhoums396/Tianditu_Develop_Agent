package com.tianditu.authbridgeofficial.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "bridge.auth")
public class BridgeAuthProperties {
  private String cookieName = "tdt_auth";
  private String sharedSecret = "change-this-in-production";
  private long cookieMaxAgeSeconds = 21600L;
  private boolean cookieSecure;
  private String cookieDomain;
  private String defaultRedirect = "/workspace";
  private String logoutRedirect = "/";
  private String casLogoutUrl;
  private String sdkAccessKey;
  private String sdkSecretKey;
  private boolean userInfoLookupEnabled = true;

  public String getCookieName() {
    return cookieName;
  }

  public void setCookieName(String cookieName) {
    this.cookieName = cookieName;
  }

  public String getSharedSecret() {
    return sharedSecret;
  }

  public void setSharedSecret(String sharedSecret) {
    this.sharedSecret = sharedSecret;
  }

  public long getCookieMaxAgeSeconds() {
    return cookieMaxAgeSeconds;
  }

  public void setCookieMaxAgeSeconds(long cookieMaxAgeSeconds) {
    this.cookieMaxAgeSeconds = cookieMaxAgeSeconds;
  }

  public boolean isCookieSecure() {
    return cookieSecure;
  }

  public void setCookieSecure(boolean cookieSecure) {
    this.cookieSecure = cookieSecure;
  }

  public String getCookieDomain() {
    return cookieDomain;
  }

  public void setCookieDomain(String cookieDomain) {
    this.cookieDomain = cookieDomain;
  }

  public String getDefaultRedirect() {
    return defaultRedirect;
  }

  public void setDefaultRedirect(String defaultRedirect) {
    this.defaultRedirect = defaultRedirect;
  }

  public String getLogoutRedirect() {
    return logoutRedirect;
  }

  public void setLogoutRedirect(String logoutRedirect) {
    this.logoutRedirect = logoutRedirect;
  }

  public String getCasLogoutUrl() {
    return casLogoutUrl;
  }

  public void setCasLogoutUrl(String casLogoutUrl) {
    this.casLogoutUrl = casLogoutUrl;
  }

  public String getSdkAccessKey() {
    return sdkAccessKey;
  }

  public void setSdkAccessKey(String sdkAccessKey) {
    this.sdkAccessKey = sdkAccessKey;
  }

  public String getSdkSecretKey() {
    return sdkSecretKey;
  }

  public void setSdkSecretKey(String sdkSecretKey) {
    this.sdkSecretKey = sdkSecretKey;
  }

  public boolean isUserInfoLookupEnabled() {
    return userInfoLookupEnabled;
  }

  public void setUserInfoLookupEnabled(boolean userInfoLookupEnabled) {
    this.userInfoLookupEnabled = userInfoLookupEnabled;
  }
}
