export namespace creds {
	
	export class Secret {
	    found: boolean;
	    value?: string;
	
	    static createFrom(source: any = {}) {
	        return new Secret(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.value = source["value"];
	    }
	}

}

export namespace dialogs {
	
	export class MessageOptions {
	    kind: string;
	    title: string;
	    message: string;
	    buttons?: string[];
	    defaultButton?: string;
	    cancelButton?: string;
	
	    static createFrom(source: any = {}) {
	        return new MessageOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.message = source["message"];
	        this.buttons = source["buttons"];
	        this.defaultButton = source["defaultButton"];
	        this.cancelButton = source["cancelButton"];
	    }
	}

}

export namespace fsapi {
	
	export class FileContent {
	    path: string;
	    size: number;
	    text?: string;
	    base64?: string;
	    isBinary: boolean;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileContent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.size = source["size"];
	        this.text = source["text"];
	        this.base64 = source["base64"];
	        this.isBinary = source["isBinary"];
	        this.truncated = source["truncated"];
	    }
	}
	export class FileInfo {
	    name: string;
	    path: string;
	    size: number;
	    isDir: boolean;
	    modTime: number;
	    mode: string;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.modTime = source["modTime"];
	        this.mode = source["mode"];
	    }
	}

}

export namespace gitexec {
	
	export class GitInfo {
	    path: string;
	    version: string;
	    available: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GitInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.version = source["version"];
	        this.available = source["available"];
	    }
	}
	export class RunRequest {
	    repoPath: string;
	    args: string[];
	    stdin?: string;
	    env?: string[];
	    timeoutMs?: number;
	
	    static createFrom(source: any = {}) {
	        return new RunRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repoPath = source["repoPath"];
	        this.args = source["args"];
	        this.stdin = source["stdin"];
	        this.env = source["env"];
	        this.timeoutMs = source["timeoutMs"];
	    }
	}
	export class RunResult {
	    stdout: string;
	    stderr: string;
	    exitCode: number;
	    durationMs: number;
	    timedOut: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RunResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stdout = source["stdout"];
	        this.stderr = source["stderr"];
	        this.exitCode = source["exitCode"];
	        this.durationMs = source["durationMs"];
	        this.timedOut = source["timedOut"];
	    }
	}
	export class StreamRequest {
	    repoPath: string;
	    args: string[];
	    stdin?: string;
	    env?: string[];
	    timeoutMs?: number;
	    delimiter?: string;
	    chunkSize?: number;
	
	    static createFrom(source: any = {}) {
	        return new StreamRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repoPath = source["repoPath"];
	        this.args = source["args"];
	        this.stdin = source["stdin"];
	        this.env = source["env"];
	        this.timeoutMs = source["timeoutMs"];
	        this.delimiter = source["delimiter"];
	        this.chunkSize = source["chunkSize"];
	    }
	}
	export class StreamResult {
	    stderr: string;
	    exitCode: number;
	    durationMs: number;
	    timedOut: boolean;
	    canceled: boolean;
	    bytesOut: number;
	    chunks: number;
	
	    static createFrom(source: any = {}) {
	        return new StreamResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stderr = source["stderr"];
	        this.exitCode = source["exitCode"];
	        this.durationMs = source["durationMs"];
	        this.timedOut = source["timedOut"];
	        this.canceled = source["canceled"];
	        this.bytesOut = source["bytesOut"];
	        this.chunks = source["chunks"];
	    }
	}

}

export namespace main {
	
	export class Environment {
	    platform: string;
	    arch: string;
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new Environment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.arch = source["arch"];
	        this.version = source["version"];
	    }
	}

}

export namespace store {
	
	export class DBInfo {
	    path: string;
	    open: boolean;
	    version: string;
	    hasFts5: boolean;
	    pageCount: number;
	    sizeOnDisk: number;
	    journalMode: string;
	
	    static createFrom(source: any = {}) {
	        return new DBInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.open = source["open"];
	        this.version = source["version"];
	        this.hasFts5 = source["hasFts5"];
	        this.pageCount = source["pageCount"];
	        this.sizeOnDisk = source["sizeOnDisk"];
	        this.journalMode = source["journalMode"];
	    }
	}
	export class ExecResult {
	    rowsAffected: number;
	    lastInsertId: number;
	
	    static createFrom(source: any = {}) {
	        return new ExecResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rowsAffected = source["rowsAffected"];
	        this.lastInsertId = source["lastInsertId"];
	    }
	}
	export class QueryResult {
	    columns: string[];
	    rows: any[][];
	
	    static createFrom(source: any = {}) {
	        return new QueryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	    }
	}
	export class Statement {
	    sql: string;
	    args?: any[];
	
	    static createFrom(source: any = {}) {
	        return new Statement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sql = source["sql"];
	        this.args = source["args"];
	    }
	}

}

export namespace watcher {
	
	export class WatchInfo {
	    repoPath: string;
	    dirs: number;
	    degraded: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WatchInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repoPath = source["repoPath"];
	        this.dirs = source["dirs"];
	        this.degraded = source["degraded"];
	    }
	}

}

