require('dotenv').config();
const mysql = require("mysql");
const args = require('args-parser')(process.argv);
const fs = require("fs").promises;
const util = require('util');
const { performance } = require('perf_hooks');

const PLATONUS_VARIANTS_CONST = 5;

function make_question_objects(query_results) 
{
  let q_objs = [];
  const row = query_results[0];
  let q = {
    q: row.question.replace(/\n/g, " ").trim(),
    variants: [],
    answer: 0
  };
  if (row.isRight == 1) q.answer = q.variants.length;
  q.variants.push(row.answer.replace(/\n/g, " ").trim());
  q_objs.push(q);

  for (let i = 1; i < query_results.length; ++i) 
  {
    const row = query_results[i];
    const q = row.question.replace(/\n/g, " ").trim();
    const v = row.answer.replace(/\n/g, " ").trim();
    const t = row.isRight;

    // sometimes variants count isnt 5, in same time sometimes there are several equal questions 
    let prev_q = q_objs.at(-1);
    if (prev_q.q != q || prev_q.variants.length == PLATONUS_VARIANTS_CONST) 
    {
      q_objs.push({
        q: q,
        variants: [],
        answer: 0
      });
    }

    prev_q = q_objs.at(-1);
    if (t == 1) prev_q.answer = prev_q.variants.length;
    prev_q.variants.push(v);
  }

  return q_objs;
}

function add_slash_N(str) 
{
  if (str[str.length-1] != "\n") return str + "\n";
  return str;
}

const A_code = "A".codePointAt(0);
const Z_code = "Z".codePointAt(0);

function make_question_aiken(q_obj) 
{
  let str = q_obj.q + "\n"; 

  if (A_code + q_obj.variants.length > Z_code) throw "Too many variants";

  for (let j = 0; j < q_obj.variants.length; ++j) 
  {
    const letter = String.fromCodePoint(A_code + j);
    let local_var = letter + ". " + q_obj.variants[j] + "\n";
    str = str + local_var;
  }

  const letter = String.fromCodePoint(A_code + q_obj.answer);
  str = str + "ANSWER: " + letter + "\n\n";
  return str;
}

const Q_str = "<question>";
const V_str = "<variant>";

function make_question_platonus(q_obj) 
{
  if (q_obj.q == undefined) return "";
  let str = Q_str + q_obj.q + "\n";

  let answer_str = V_str + q_obj.variants[q_obj.answer]; // right answer is first
  str = str + answer_str; 

  for (let j = 0; j < q_obj.variants.length; ++j) 
  {
    if (j == q_obj.answer) continue; // put other answers after right one
    let local_var = V_str + q_obj.variants[j] + "\n";
    str = str + local_var;
  }
  
  return str;
}

function is_digit(c) { return c >= '0' && c <= '9'; }

function all_digits(str) 
{
  for (let c of str) 
  {
    if (!is_digit(c)) return false;
  }

  return true;
}

function valid_test_name(data) 
{
  return data.length > 0 && data[0].testName != undefined && data[0].testName != null;
}

function valid_test_metadata(data) 
{
  return data.length > 0 && data[0].cafedraNameRU != undefined && data[0].cafedraNameRU != null && data[0].testName != undefined && data[0].testName != null;
}

let current_maker_func = make_question_aiken;
if (args.a || args.aiken) {
  current_maker_func = make_question_aiken;
} else if (args.p || args.platonus) {
  current_maker_func = make_question_platonus;
}

function make_valid_str(str) {
  return str.replaceAll("\"", "_");
}

// i hope table names in platonus are shared between organizations 
const SQL_QUERY_TEST_ROWS_STRING = "SELECT q.question , o.answer, o.isRight FROM openanswers o JOIN questions q ON o.questionID = q.questionID WHERE q.testID = ";
const SQL_QUERY_TEST_NAME_STRING = `
SELECT t.testID, t.testName, c.cafedraNameRU FROM tests t 
JOIN tutors t1 ON t.tutorID = t1.tutorID 
LEFT JOIN cafedras c ON t1.CafedraID = c.cafedraID 
WHERE t.testID = `;

const config = {
  //debug    : true,
  host     : process.env.DATABASE_HOST,
  port     : process.env.DATABASE_PORT,
  user     : process.env.DATABASE_USER,
  password : process.env.DATABASE_PASSWORD,
  database : process.env.DATABASE_NAME,
};

var connection = mysql.createConnection(config);
const connect = util.promisify(connection.connect).bind(connection);
const query = util.promisify(connection.query).bind(connection);

(async () => {
  try {
    console.info("Connecting to database");
    const start_time = performance.now();
    await connect();
    var end_time = performance.now();
    console.info(`Connection took ${end_time - start_time} milliseconds`);

    let atleast_once = false;
    for (let key in args) {
      if (!all_digits(key)) continue;
      atleast_once = true;

      const test_id = key; // первые два аргумента это node index.js, ожидаем в следующем id теста
      if (test_id == undefined || test_id == null || typeof test_id != "string") 
      {
        console.info("Provide test id");
        return;
      }

      const final_query_str = SQL_QUERY_TEST_ROWS_STRING + test_id + ";"; 
      const final_query_name_str = SQL_QUERY_TEST_NAME_STRING + test_id + ";"; 

      const results = await query(final_query_str);
      const test_name = await query(final_query_name_str);

      console.info("Getting " + results.length + " rows from database for test " + test_id);
      if (results.length == 0) 
      {
        console.warn("Could not find data for test " + test_id);
        continue;
      }

      const q_objs = make_question_objects(results);
      console.info("Parsed " + q_objs.length + " questions for test " + test_id);

      let output = "";
      let counter = 0;
      for (let q of q_objs) 
      {  
        counter = counter + 1;
        if (q.variants.length < 2) 
        {
          console.warn("Question '" + q.q + "' has only one variant, skipping");
          continue;
        }

        const str = current_maker_func(q);
        output = output + str;
      }

      let info_str = "";
      let output_file = "";
      if (valid_test_metadata(test_name)) 
      {
        output_file = make_valid_str(test_name[0].cafedraNameRU + " " + test_name[0].testName) + ".txt";
        info_str = test_name[0].testName;
      }
      else if (valid_test_name(test_name)) 
      {
        console.warn("Could not find cafedra name for test " + test_id);
        output_file = make_valid_str(test_name[0].testName) + ".txt";
        info_str = test_name[0].testName;
      }
      else
      {
        console.warn("Could not find test metadata for test " + test_id);
        output_file = test_id + ".txt";
        info_str = test_id + "";
      }

      output_file = output_file.replaceAll("\\", "_").replaceAll("/", "_").replaceAll(",", "_");
      const f = await fs.open(output_file, "w");
      await fs.writeFile(f, output);
      console.info("Test '" + info_str + "' created");
      await f.close();
    }

    if (!atleast_once) console.log("At lest one test id must be specified");
  } 
  catch (err) 
  {
    console.error(err);
  }
  finally 
  {
    connection.end();
  }
})();