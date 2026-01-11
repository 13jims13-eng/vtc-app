import assert from "node:assert/strict";
import { validateSlackWebhookUrl } from "../app/lib/bookingNotify.server";

function ok(url: string) {
  const res = validateSlackWebhookUrl(url);
  assert.equal(res.ok, true, `Expected ok for ${url}`);
}

function ko(url: string) {
  const res = validateSlackWebhookUrl(url);
  assert.equal(res.ok, false, `Expected ko for ${url}`);
}

ok("https://hooks.slack.com/services/T000/B000/XXX");
ko("http://hooks.slack.com/services/T000/B000/XXX");
ko("https://example.com");
ko("not a url");

// eslint-disable-next-line no-console
console.log("validateSlackWebhookUrl: OK");
