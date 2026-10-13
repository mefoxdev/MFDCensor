import { config } from "../../config.js";
import { getPermission } from "../../lib/censor-proto.js";
const familyLevel = { A: 0, DV: 1, DI: 2, M: 3 };
async function requirePermission(ctx, minimum) {
    const tgid = ctx.from?.id;
    if (tgid === undefined) {
        return false;
    }
    if (String(tgid) === String(config.OwnerInfo.OwnerID)) {
        return true;
    }
    try {
        const permission = await getPermission({ tgid });
        const allowed = familyLevel[permission.family] >= familyLevel[minimum.family] && permission.rank >= minimum.rank;
        if (!allowed)
            await ctx.reply(`[denied] required role A3, you have ${permission.family}${permission.rank}!`);
        return allowed;
    }
    catch (error) {
        console.error("permission check failed", error);
        await ctx.reply("[denied] permission check failed, escalate this message to the owner or support", {
            reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id } : undefined,
        });
        return false;
    }
}
export function registerCommands(bot) {
    bot.command('start', cmdStart);
    bot.command('help', cmdHelp);
    bot.command('support', cmdSupport);
    bot.command('privacy', cmdPrivacy);
    bot.command('ban', cmdBan);
}
async function cmdStart(ctx) {
    await ctx.reply("Welcome to TSBOT Corporation");
}
// TODO: /support, /privacy
async function cmdHelp(ctx) {
    await ctx.reply(`
    commands list:
  \\- /start \\- restart the bot
  \\- /help \\- show this help message
  \\- /support \\- contact support
  \\- /privacy \\- show privacy policy
    `, {
        parse_mode: 'MarkdownV2',
    });
}
async function cmdSupport(ctx) {
    await ctx.reply('Contacts in bot\'s bio');
}
async function cmdPrivacy(ctx) {
    await ctx.reply('Your rights comply with GDPR');
}
async function cmdBan(ctx) {
    let fromRank = 3;
    if (!(await requirePermission(ctx, { family: "A", rank: fromRank }))) {
        return;
    }
    const reply = ctx.msg?.reply_to_message;
    if (!reply?.from) {
        await ctx.reply('[denied] just reply to a user\'s message to ban them');
        return;
    }
    const userId = reply.from.id;
    try {
        await ctx.banChatMember(userId);
        await ctx.reply(`banned ${reply.from.first_name}`);
    }
    catch (error) {
        console.error(error);
        await ctx.reply('failed to ban user');
    }
}
