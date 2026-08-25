'use strict';

const { PopdexApiError } = require('../api/client');

/**
 * Maps any error thrown while handling a command/interaction into a short,
 * user-safe message. Never exposes stack traces, raw HTTP codes, wallet
 * internals, or API error payloads to Discord — those go to console.error
 * only.
 */
function toUserMessage(err) {
  if (err instanceof PopdexApiError) {
    if (err.status === 404) return 'That data isn’t available right now.';
    if (err.message?.toLowerCase().includes('timed out')) {
      return 'Popdex is taking too long to respond — try again in a moment.';
    }
    if (err.message?.toLowerCase().includes('could not reach')) {
      return 'Couldn’t reach the Popdex API — try again shortly.';
    }
    return 'Popdex API returned an error — try again shortly.';
  }
  if (err?.message?.toLowerCase?.().includes('wallet')) {
    return err.message;
  }
  return 'Something went wrong handling that request.';
}

/**
 * Wraps a command handler so any thrown error is logged with full detail
 * server-side and replaced with a clean ephemeral message to the user.
 */
function safeHandler(fn) {
  return async (interaction, ...rest) => {
    try {
      await fn(interaction, ...rest);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[command:${interaction.commandName || interaction.customId || 'unknown'}]`, err);
      const content = `⚠️ ${toUserMessage(err)}`;
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content, embeds: [], files: [], components: [] });
        } else {
          await interaction.reply({ content, ephemeral: true });
        }
      } catch (replyErr) {
        console.error('[safeHandler] failed to notify user of error', replyErr);
      }
    }
  };
}

module.exports = { toUserMessage, safeHandler };
