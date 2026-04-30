const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function listUsers() {
    const { data, error } = await supabase.from('user_profiles').select('*');
    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}

listUsers();
