CREATE VIRTUAL TABLE course_search USING fts5(title,teacher,code,body,tokenize='trigram');
