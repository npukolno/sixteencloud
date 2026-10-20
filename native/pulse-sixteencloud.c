/*
 * pulse-sixteencloud — PulseAudio identity shim for SixteenCloud.
 *
 * Chromium hardcodes its own PulseAudio identity: the stream is published as
 * "Chromium" / "chromium-browser", so the Linux volume mixer (and anything else
 * reading the PulseAudio client properties) shows another app's name and icon.
 * Neither CHROME_DESKTOP nor PULSE_PROP_OVERRIDE can change it, because the
 * values are written into the stream proplist by Chromium itself after those
 * overrides are applied.
 *
 * This library is preloaded with LD_PRELOAD and rewrites the three identity
 * properties as they are written into any libpulse proplist. Every hook is
 * failure tolerant: if the real libpulse symbol cannot be resolved the call is
 * refused instead of crashing the audio service (audio must keep working even
 * if this shim is stale).
 *
 * Build: scripts/build-pulse-shim.mjs (gcc -shared -fPIC -O2 -ldl)
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stddef.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>

/* Opaque libpulse types: the shim only forwards pointers, so the headers are
 * not required at build time. */
typedef struct pa_proplist pa_proplist;
typedef struct pa_context pa_context;
typedef struct pa_stream pa_stream;
typedef struct pa_mainloop_api pa_mainloop_api;
typedef struct pa_sample_spec pa_sample_spec;
typedef struct pa_channel_map pa_channel_map;

/* Chromium dlopens libpulse lazily, so the library is not part of the main
 * image's dependency chain and RTLD_NEXT alone cannot see it. Prefer the
 * already-loaded libpulse handle, then fall back to the global scope. */
static void *libpulse_handle(void) {
  static void *handle;
  if (!handle) handle = dlopen("libpulse.so.0", RTLD_LAZY | RTLD_NOLOAD);
  if (!handle) handle = dlopen("libpulse.so.0", RTLD_LAZY | RTLD_LOCAL);
  return handle;
}

static void *real_symbol(const char *name) {
  void *handle = libpulse_handle();
  void *symbol = handle ? dlsym(handle, name) : NULL;
  if (!symbol) symbol = dlsym(RTLD_NEXT, name);
  return symbol;
}

static const char *replacement(const char *key) {
  if (!key) return NULL;
  if (!strcmp(key, "application.name")) return "SixteenCloud";
  if (!strcmp(key, "application.icon_name")) return "sixteencloud";
  if (!strcmp(key, "application.id")) return "com.sixteencloud.app";
  return NULL;
}

static void force_identity(pa_proplist *list) {
  int (*sets)(pa_proplist *, const char *, const char *);
  if (!list) return;
  sets = (int (*)(pa_proplist *, const char *, const char *))real_symbol("pa_proplist_sets");
  if (!sets) return;
  sets(list, "application.name", "SixteenCloud");
  sets(list, "application.icon_name", "sixteencloud");
  sets(list, "application.id", "com.sixteencloud.app");
}

int pa_proplist_sets(pa_proplist *list, const char *key, const char *value) {
  int (*real)(pa_proplist *, const char *, const char *);
  const char *override = replacement(key);
  real = (int (*)(pa_proplist *, const char *, const char *))real_symbol("pa_proplist_sets");
  if (!real) return 0;
  return real(list, key, override ? override : value);
}

int pa_proplist_set(pa_proplist *list, const char *key, const void *data, size_t nbytes) {
  int (*real)(pa_proplist *, const char *, const void *, size_t);
  const char *override = replacement(key);
  real = (int (*)(pa_proplist *, const char *, const void *, size_t))real_symbol("pa_proplist_set");
  if (!real) return 0;
  if (override) return real(list, key, override, strlen(override));
  return real(list, key, data, nbytes);
}

int pa_proplist_setf(pa_proplist *list, const char *key, const char *format, ...) {
  int (*real)(pa_proplist *, const char *, const char *, ...);
  const char *override = replacement(key);
  char buffer[4096];
  va_list args;
  real = (int (*)(pa_proplist *, const char *, const char *, ...))real_symbol("pa_proplist_setf");
  if (!real) return 0;
  if (override) return real(list, key, "%s", override);
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  return real(list, key, "%s", buffer);
}

int pa_proplist_update(pa_proplist *list, int mode, const pa_proplist *other) {
  int (*real)(pa_proplist *, int, const pa_proplist *);
  int result;
  real = (int (*)(pa_proplist *, int, const pa_proplist *))real_symbol("pa_proplist_update");
  if (!real) return 0;
  result = real(list, mode, other);
  force_identity(list);
  return result;
}

pa_proplist *pa_proplist_from_string(const char *text) {
  pa_proplist *(*real)(const char *);
  pa_proplist *list;
  real = (pa_proplist *(*)(const char *))real_symbol("pa_proplist_from_string");
  if (!real) return NULL;
  list = real(text);
  force_identity(list);
  return list;
}

pa_context *pa_context_new_with_proplist(pa_mainloop_api *api, const char *name, pa_proplist *list) {
  pa_context *(*real)(pa_mainloop_api *, const char *, pa_proplist *);
  real = (pa_context *(*)(pa_mainloop_api *, const char *, pa_proplist *))real_symbol("pa_context_new_with_proplist");
  if (!real) return NULL;
  force_identity(list);
  return real(api, name, list);
}

pa_stream *pa_stream_new_with_proplist(pa_context *ctx, const char *name, const pa_sample_spec *spec, const pa_channel_map *map, pa_proplist *list) {
  pa_stream *(*real)(pa_context *, const char *, const pa_sample_spec *, const pa_channel_map *, pa_proplist *);
  real = (pa_stream *(*)(pa_context *, const char *, const pa_sample_spec *, const pa_channel_map *, pa_proplist *))real_symbol("pa_stream_new_with_proplist");
  if (!real) return NULL;
  force_identity(list);
  return real(ctx, name, spec, map, list);
}
