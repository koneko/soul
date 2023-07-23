const { EmbedBuilder } = require("discord.js");
const { create } = require("domain");
const fs = require("fs")
let commands = []

const clean = async (text, client) => {
    if (text && text.constructor.name == "Promise") text = await text;
    if (typeof text !== "string") text = require("util").inspect(text, { depth: 1 });
    text = text
        .replace(/`/g, "`" + String.fromCharCode(8203))
        .replace(/@/g, "@" + String.fromCharCode(8203));
    text = text.replaceAll(client.token, "[REDACTED]");
    return text;
}

function createCommand (name, description, run) {
    let command = {}
    command.name = name
    command.description = description
    command.run = run
    commands.push(command)
}

function calculateUptime (uptime) {
    let days = Math.floor(uptime / 86400000)
    let hours = Math.floor(uptime / 3600000) % 24
    let minutes = Math.floor(uptime / 60000) % 60
    let seconds = Math.floor(uptime / 1000) % 60
    return { days, hours, minutes, seconds }
}

function embed (message, msg) {
    let embed = new EmbedBuilder()
        .setDescription(msg)
        .setColor("#0000ff")
    return message.channel.send({ embeds: [embed] })
}

async function sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

createCommand("help", "Shows this messsage", function (client, message, args) {
    let msg = []
    for (let i = 0; i < commands.length; i++) {
        msg.push(commands[i].name + " - " + commands[i].description)
    }
    msg = msg.join("\n")
    const embed = new EmbedBuilder()
        .setDescription(msg)
        .setColor("#0000ff")
        .setFooter({ text: "<required> - [optional]" })
    message.channel.send({ embeds: [embed] })
})

createCommand("uptime", "Shows soul uptime", function (client, message, args) {
    let { days, hours, minutes, seconds } = calculateUptime(client.uptime)
    let uptime = `${days}d ${hours}h ${minutes}m ${seconds}s`
    const embed = new EmbedBuilder()
        .setDescription(`${uptime}`)
        .setColor("#0000ff")
    message.channel.send({ embeds: [embed] })
})

createCommand("eval", "<code> - Evaluates code", async function (client, message, args) {
    if (message.author.id !== client.ownerID) return;
    try {
        const evaled = eval(args.join(" "));
        var cleaned = await clean(evaled, client);
        message.channel.send(`\`\`\`js\n${cleaned}\n\`\`\``);
    } catch (err) {
        message.channel.send(`\`ERROR\` \`\`\`xl\n${cleaned}\n\`\`\``);
    }
})

createCommand("create", "<name> - Creates a new project", function (client, message, args) {
    let Project = client.Project
    let Process = client.Process

    if (args.length < 1) {
        message.channel.send("Please provide a name for the project.")
        return
    }
    let name = args[0]
    if (name == "soul") return
    let project = new Project(name)
    project.update()
    embed(message, `Created project ${name}.`)
})

createCommand("delete", "<name> - Deletes a project", async function (client, message, args) {
    let Project = client.Project
    let Process = client.Process

    if (args.length < 1) {
        message.channel.send("Please provide a name for the project.")
        return
    }
    let name = args[0]
    if (name == "soul") return
    let project = new Project(name)
    let success = await project.remove()
    if (!success) {
        message.channel.send("Project not found.")
        return
    }
    embed(message, `Deleted project ${name}.`)
})

createCommand("project", "<name> [options] - Shows/Changes project info", async function (client, message, args) {
    let Project = client.Project
    let Process = client.Process

    if (args.length < 1) {
        message.channel.send("Please provide a project name.")
        return
    }
    let name = args[0]
    if (name == "soul") return
    let project = new Project(name)

    if (!project.exists()) {
        message.channel.send("Project not found.")
        return
    }
    project.populate()

    if (args.length < 2) {
        let msg = []
        msg.push(`**Project ${name}**`)
        msg.push(`Github Link (github): ${project.githubLink}`)
        msg.push(`Auto Start (auto): ${project.autoStart}`)
        msg.push(`Command (command): ${project.command}`)
        msg.push(`Args (args): ${project.args}`)
        msg.push(`Environment Variables (env): ${JSON.stringify(project.env)}`)
        msg = msg.join("\n")
        embed(message, msg)
        return
    }

    let option = args[1]
    if (option == "set") {
        if (args.length < 4) {
            message.channel.send("Please provide a valid option and value.")
            return
        }
        let option = args[2]
        let value = args[3]
        if (option == "github") {
            project.setLink(value)
            project.update()
            embed(message, `Set github link for project ${name} to ${value}.`)
        } else if (option == "auto") {
            if (value == "true") value = true
            else if (value == "false") value = false
            else {
                message.channel.send("Please provide a valid value. (true/false)")
                return
            }
            project.autoStart = value
            project.update()
            embed(message, `Set auto start for project ${name} to ${value}.`)
        } else if (option == "command") {
            project.command = value
            project.update()
            embed(message, `Set command for project ${name} to ${value}.`)
        } else if (option == "args") {
            // join args
            let projectArgs = args.slice(3)
            project.args = projectArgs.join(" ")
            project.update()
            embed(message, `Set args for project ${name} to ${projectArgs.join(" ")}.`)
        } else if (option == "env") {
            if (args.length < 5) {
                message.channel.send("Please provide a valid option and value.")
                return
            }
            let envOption = args[3]
            let envValue = args[4]
            project.env[envOption] = envValue
            project.update()
            embed(message, `Set env variable ${envOption} for project ${name} to ${envValue}.`)
        } else {
            message.channel.send("Please provide a valid option.")
        }
    } else if (option == "sync") {
        let sentMsg = null
        embed(message, `:hourglass_flowing_sand: Syncing...`).then(msg => sentMsg = msg)
        try {
            let errors = await project.syncFs()
            let msg = []
            msg.push(`:hourglass: **Syncing finished.**\n#### Errors:`)
            errors.forEach(e => {
                msg.push("- " + project.interpretSyncError(e))
            })
            if (msg.length == 0) msg.push(project.interpretSyncError("none"))
            msg = msg.join("\n")
            let newEmbed = new EmbedBuilder()
                .setDescription(msg)
                .setColor("#0000ff")
            sentMsg.edit({ embeds: [newEmbed] })
        }
        catch (err) {
            message.channel.send("An error occured while syncing the project.")
        }
    } else if (option == "start") {
        let process = project.getProcess()
        if (process != null) {
            message.channel.send(`Project ${name} is already running.`)
            return
        }
        let proc = new Process(project.name, project.command, project.env, project.args)
        proc.start()
        embed(message, `Started project ${name}.`)
    }

})

createCommand("list", "<type (projects/processes)> - Lists projects/processes", function (client, message, args) {
    let type = args[0]
    if (type == "projects") {
        let projects = JSON.parse(fs.readFileSync("./projects.json", "utf8"))
        let msg = []
        msg.push("**Projects**")
        projects.forEach(p => {
            msg.push(p.name)
        })
        msg = msg.join("\n")
        embed(message, msg)
    }
    else if (type == "processes") {
        let msg = []
        msg.push("**Processes**")
        client.processes.forEach(p => {
            let { days, hours, minutes, seconds } = calculateUptime(p.elapsed())
            let uptime = `${days}d ${hours}h ${minutes}m ${seconds}s`
            msg.push(p.name + " - " + uptime)
        })
        msg = msg.join("\n")
        embed(message, msg)
    } else {
        message.channel.send("Please provide a valid type. (projects/processes)")
    }
})


module.exports.commands = commands