// Review-only; inject private credentials using existing deployment secret handling.
module.exports={apps:[{name:'struct-observability',script:'observability-worker.js',cwd:__dirname,instances:1,exec_mode:'fork',max_memory_restart:'256M',kill_timeout:20000,env:{STRUCT_OBSERVABILITY_ENABLED:'true'}}]}
