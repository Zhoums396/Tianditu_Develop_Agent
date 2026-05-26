package com.tianditu.authbridgeofficial.web;

import com.tianditu.authbridgeofficial.config.BridgeAuthProperties;
import com.tianditu.authbridgeofficial.model.BridgeUser;
import com.tianditu.authbridgeofficial.service.CurrentTiandituUserService;
import com.tianditu.authbridgeofficial.service.ProjectSessionTokenService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping({"/sso", "/ai/dev/sso"})
public class SsoBridgeController {
  private final BridgeAuthProperties properties;
  private final CurrentTiandituUserService currentTiandituUserService;
  private final ProjectSessionTokenService projectSessionTokenService;

  public SsoBridgeController(
      BridgeAuthProperties properties,
      CurrentTiandituUserService currentTiandituUserService,
      ProjectSessionTokenService projectSessionTokenService
  ) {
    this.properties = properties;
    this.currentTiandituUserService = currentTiandituUserService;
    this.projectSessionTokenService = projectSessionTokenService;
  }

  @GetMapping("/health")
  public Map<String, Object> health() {
    Map<String, Object> data = new LinkedHashMap<String, Object>();
    data.put("status", "ok");
    data.put("mode", "official-springboot2");
    data.put("cookieName", properties.getCookieName());
    data.put("userInfoLookupEnabled", properties.isUserInfoLookupEnabled());
    return wrapSuccess(data);
  }

  @GetMapping("/me")
  public Map<String, Object> me(HttpServletRequest request) {
    Optional<BridgeUser> user = currentTiandituUserService.resolveCurrentUser(request);
    Map<String, Object> data = new LinkedHashMap<String, Object>();
    data.put("authenticated", user.isPresent());
    data.put("user", user.orElse(null));
    data.put("principalAttributes", currentTiandituUserService.currentPrincipalAttributes(request));
    return wrapSuccess(data);
  }

  @GetMapping("/login")
  public void login(
      @RequestParam(value = "redirect", required = false) String redirect,
      HttpServletRequest request,
      HttpServletResponse response
  ) throws IOException {
    BridgeUser user = currentTiandituUserService.resolveCurrentUser(request)
        .orElseThrow(() -> new IllegalStateException("当前请求尚未完成统一登录认证"));

    ResponseCookie cookie = buildSessionCookie(projectSessionTokenService.sign(user));
    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    response.sendRedirect(sanitizeRedirect(redirect, properties.getDefaultRedirect()));
  }

  @GetMapping("/logout")
  public ResponseEntity<Void> logout(@RequestParam(value = "redirect", required = false) String redirect) {
    ResponseCookie expired = ResponseCookie.from(properties.getCookieName(), "")
        .httpOnly(true)
        .secure(properties.isCookieSecure())
        .sameSite("Lax")
        .path("/")
        .maxAge(0)
        .domain(StringUtils.hasText(properties.getCookieDomain()) ? properties.getCookieDomain() : null)
        .build();

    String target = buildLogoutTarget(redirect);
    return ResponseEntity.status(HttpStatus.FOUND)
        .header(HttpHeaders.SET_COOKIE, expired.toString())
        .header(HttpHeaders.LOCATION, target)
        .build();
  }

  private ResponseCookie buildSessionCookie(String token) {
    ResponseCookie.ResponseCookieBuilder builder = ResponseCookie.from(properties.getCookieName(), token)
        .httpOnly(true)
        .secure(properties.isCookieSecure())
        .sameSite("Lax")
        .path("/")
        .maxAge(properties.getCookieMaxAgeSeconds());
    if (StringUtils.hasText(properties.getCookieDomain())) {
      builder.domain(properties.getCookieDomain());
    }
    return builder.build();
  }

  private String buildLogoutTarget(String redirect) {
    String fallback = sanitizeRedirect(redirect, properties.getLogoutRedirect());
    if (!StringUtils.hasText(properties.getCasLogoutUrl())) {
      return fallback;
    }
    return properties.getCasLogoutUrl() + "?service=" + urlEncode(fallback);
  }

  private String sanitizeRedirect(String redirect, String fallback) {
    String value = StringUtils.hasText(redirect) ? redirect.trim() : fallback;
    if (!StringUtils.hasText(value)) {
      return "/";
    }
    if (!value.startsWith("/") || value.startsWith("//")) {
      return fallback;
    }
    return value;
  }

  private String urlEncode(String value) {
    return value.replace("%", "%25").replace(" ", "%20").replace("?", "%3F").replace("=", "%3D").replace("&", "%26").replace("/", "%2F").replace(":", "%3A");
  }

  private Map<String, Object> wrapSuccess(Object data) {
    Map<String, Object> payload = new LinkedHashMap<String, Object>();
    payload.put("success", true);
    payload.put("data", data);
    return payload;
  }
}
