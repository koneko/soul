const { token, prefix, ownerID } = require('./config.json');
const { commands } = require("./commands.js")
const { Client, Events, GatewayIntentBits } = require('discord.js');
const fs = require("fs")
const simpleGit = require("simple-git")
const path = require("path")
const util = require('util');
const fsPromises = fs.promises;
const fsRmAsync = util.promisify(fsPromises.rm);


const client = new Client({
    intents: [GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,]
});

function generateRandomDirectoryName () {
    const timestamp = Date.now();
    return `temp_${timestamp}`;
}

async function sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class Process {
    constructor (projectName, command, env, args) {
        this.args = args
        this.name = projectName
        this.command = command
        this.env = env
        this.startedTime = Date.now()
        this.proc = null
        this.stdout = []
        client.processes.push(this)
    }
    elapsed () {
        return Date.now() - this.startedTime
    }
    start () {
        console.log(this.command, this.args, { env: { ...this.env } })
        let projectPath = path.join(process.cwd(), `./projects/${this.name}`)
        let proc = client.spawn(this.command, this.args, { cwd: projectPath, env: { ...process.env, ...this.env } })
        this.proc = proc
        proc.stdout.on("data", (data) => {
            let timestamp = new Date()
            let time = `[${timestamp.getHours()}:${timestamp.getMinutes()}:${timestamp.getSeconds()}] `
            // if this.stdout is > 50 lines, remove the first line
            if (this.stdout.length > 50) this.stdout.shift()
            this.stdout.push(time + data.toString())
            console.log(data.toString())
        })
        proc.stderr.on("data", (data) => {
            let timestamp = new Date()
            let time = `[${timestamp.getHours()}:${timestamp.getMinutes()}:${timestamp.getSeconds()}] `
            // if this.stdout is > 50 lines, remove the first line
            if (this.stdout.length > 50) this.stdout.shift()
            this.stdout.push(time + data.toString())
            console.error(data.toString())
        })
    }
    restart () {
        if (this.proc == null) return
        this.proc.kill()
        this.start()
    }
    kill () {
        if (this.proc == null) return
        this.proc.kill()
        this.proc = null
        this.remove()
        // delete self
        delete this
    }
    remove () {
        client.processes.splice(client.processes.indexOf(this), 1)
    }
    getLogs () {
        return this.stdout
    }
}

class Project {
    constructor (name) {
        this.name = name
        this.githubLink = ""
        this.env = {}
        this.autoStart = false
        this.command = ""
        this.args = []
    }
    setLink (link) {
        this.githubLink = link
    }
    addEnv (key, value) {
        this.env[key] = value
    }
    setCommand (command) {
        this.command = command
    }
    setArgs (args) {
        this.args = args
    }
    setAutoStart (bool) {
        this.autoStart = bool
    }
    removeEnv (key) {
        delete this.env[key]
    }
    getProcess () {
        return client.processes.find(p => p.name === this.name)
    }
    async syncFs () {
        const projectPath = `./projects/${this.name}`;
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath);
        }

        let errors = [];

        if (this.githubLink !== "") {
            const uniqueDirName = generateRandomDirectoryName();
            const tempRepoDir = path.join(projectPath, uniqueDirName);

            const git = simpleGit();

            try {
                await git.clone(this.githubLink, tempRepoDir, ['--depth', '1']);
            } catch (error) {
                console.error('Error during clone:', error);
                errors.push("clone-error");
            }

            // Synchronize the repository to the main project directory
            try {
                // Move all contents of the tempRepoDir into the projectPath
                const tempContents = await fs.readdirSync(tempRepoDir);
                for (const content of tempContents) {
                    const srcPath = path.join(tempRepoDir, content);
                    const destPath = path.join(projectPath, content);

                    // Remove the existing destination file or directory before renaming
                    try {
                        await fs.rmSync(destPath, { recursive: true, force: true });
                    } catch (error) {
                        // Ignore any error if the file or directory doesn't exist
                    }

                    // Rename the content to the projectPath
                    await fs.renameSync(srcPath, destPath);
                }

                // Remove the empty tempRepoDir and its .git folder
                await fs.rmSync(path.join(projectPath, '.git'), { recursive: true, force: true });

                // Wait for a short delay (e.g., 100 milliseconds) before attempting to remove the temporary directory
                await sleep(100);
                await fs.rmSync(tempRepoDir, { recursive: true });
            } catch (error) {
                console.error('Error during synchronization:', error);
                errors.push("sync-error");
            }
        }

        const soulPath = path.join(projectPath, '.soul');
        if (!fs.existsSync(soulPath)) errors.push("soul-null");
        else {
            // automatically set autostart, command, and args from soul config
            let soul = JSON.parse(fs.readFileSync(soulPath, "utf8"))
            this.autoStart = soul.autoStart
            this.command = soul.command
            this.args = soul.args
        }


        if (errors.length > 0) return errors;
        else return true;
    }
    async npmInstall () {
        return new Promise((resolve, reject) => {
            const projectPath = `./projects/${this.name}`;
            const packageJsonPath = path.join(projectPath, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const npm = client.spawn('npm', ['install'], { cwd: projectPath, shell: true });
                let output = []
                npm.stdout.on('data', (data) => {
                    console.log(`npm install stdout: ${data}`);
                    output.push(data)
                });
                npm.stderr.on('data', (data) => {
                    console.error(`npm install stderr: ${data}`);
                    output.push(data)
                });
                npm.on('close', (code) => {
                    if (code === 0) {
                        output.join("\n")
                        output += "-----success-----"
                        resolve(output);
                    } else {
                        reject([code, output.join("\n")]);
                    }
                });
            }
        })

    }
    serialize () {
        let obj = {
            name: this.name,
            githubLink: this.githubLink,
            env: this.env,
            autoStart: this.autoStart,
            command: this.command,
            args: this.args
        }
        console.log(obj)
        return obj
    }
    deserialize (obj) {
        this.name = obj.name
        this.githubLink = obj.githubLink
        this.env = obj.env
        this.autoStart = obj.autoStart
        this.command = obj.command
        this.args = obj.args

        if (typeof this.args == "string") {
            // if no spaces
            if (!this.args.includes(" ")) {
                this.args = [this.args]
            } else {
                this.args = this.args.split(" ")
            }
        }
    }
    populate () {
        let projects = JSON.parse(fs.readFileSync("./projects.json", "utf8"))
        let rawP = projects.find(p => p.name === this.name)
        if (rawP == null) return false
        this.deserialize(rawP)
        return true
    }
    interpretSyncError (error) {
        if (error == "clone-error") {
            return "An error occured while cloning from github."
        } else if (error == "sync-error") {
            return "An error occured while syncing the project."
        } else if (error == "soul-null") {
            return "No soul config file found in root of project."
        } else if (error == "none") {
            return "No errors occured during sync process."
        } else if (error == "package-null") {
            return "No package.json file found in root of project."
        } else {
            return "Not a valid error."
        }
    }
    exists () {
        let projects = JSON.parse(fs.readFileSync("./projects.json", "utf8"))
        return projects.find(p => p.name === this.name) != null
    }
    update () {
        let array = JSON.parse(fs.readFileSync("./projects.json", "utf8"))
        let index = array.findIndex(p => p.name === this.name)
        if (index === -1) array.push(this.serialize())
        else array[index] = this.serialize()
        fs.writeFileSync("./projects.json", JSON.stringify(array))
    }
    async remove () {
        let projects = JSON.parse(fs.readFileSync("./projects.json", "utf8"))
        // remove from array using project name
        let index = projects.findIndex(p => p.name === this.name)
        if (index === -1) { return false }
        projects.splice(index, 1)
        fs.writeFileSync("./projects.json", JSON.stringify(projects))
        // stops process if it exists
        let process = this.getProcess()
        if (process != null) await process.kill()
        // delete project folder if it exists
        const projectPath = `./projects/${this.name}`;
        if (fs.existsSync(projectPath)) fsRmAsync(projectPath, { recursive: true, force: true });
        return true
    }
}

client.ownerID = ownerID
client.token = token
client.processes = []
client.spawn = require("child_process").spawn
client.Process = Process
client.Project = Project

client.once(Events.ClientReady, (c) => {
    console.log(`${c.user.tag} is online.`);
    client.user.setPresence({ activities: [{ name: 'with your soul' }], status: 'PLAYING' });
    // add self to processes
    new Process("soul", "node", {}, "index.js")
    // start processes
    let projects = JSON.parse(fs.readFileSync("./projects.json", "utf8"))
    projects.forEach(rawP => {
        let p = new Project(rawP.name)
        p.populate()

        if (p.getProcess() == null && p.autoStart) {
            let proc = new Process(p.name, p.command, p.env, p.args)
            proc.start()
        }
    })
})

client.on(Events.MessageCreate, async (message) => {
    // process message
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    commands.forEach(async cmd => {
        if (cmd.name === command) {
            await cmd.run(client, message, args)
        }
    })
})

client.login(token)