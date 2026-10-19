// Review-only. Private environment injection is required; no production secrets.
module.exports={apps:[{name:'struct-enterprise',script:'enterprise-worker.js',cwd:__dirname,instances:1,exec_mode:'fork',max_memory_restart:'256M',kill_timeout:20000,env:{STRUCT_ENTERPRISE_ENABLED:'true'}}]}
