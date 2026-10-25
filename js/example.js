(function (root) {
  'use strict';

  const firstPart = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Exported Data</title>
</head>
<body>
  <div class="page_wrap">
    <div class="page_header">
      <div class="content"><div class="text bold">Демо-чат TeleJSON</div></div>
    </div>
    <div class="page_body chat_page">
      <div class="history">
        <div class="message service" id="message-1">
          <div class="body details">1 мая 2025</div>
        </div>
        <div class="message default clearfix" id="message1">
          <div class="body">
            <div class="pull_right date details" title="01.05.2025 09:00:00 UTC+03:00">09:00</div>
            <div class="from_name">Анна</div>
            <div class="text">Привет! Это синтетический пример.<br>Он не содержит настоящей переписки.</div>
          </div>
        </div>
        <div class="message default clearfix joined" id="message2">
          <div class="body">
            <div class="pull_right date details" title="01.05.2025 09:01:00 UTC+03:00">09:01</div>
            <div class="text">Смотри: <b>жирный текст</b>, <code>код</code>, emoji 😀 и <a href="https://example.com/telejson">ссылка</a>.</div>
          </div>
        </div>
        <div class="message default clearfix" id="message3">
          <div class="body">
            <div class="pull_right date details" title="01.05.2025 09:02:00 UTC+03:00">09:02</div>
            <div class="from_name">Борис</div>
            <div class="reply_to details">In reply to <a href="#go_to_message1" onclick="return GoToMessage(1)">this message</a></div>
            <div class="text">Отвечаю на первое сообщение.</div>
          </div>
        </div>
        <div class="message default clearfix" id="message4">
          <div class="body">
            <div class="pull_right date details" title="01.05.2025 09:03:00 UTC+03:00">09:03</div>
            <div class="from_name">Анна</div>
            <div class="media_wrap clearfix">
              <a class="photo_wrap clearfix pull_left" href="photos/photo_demo.jpg"><img class="photo" src="photos/photo_demo.jpg" alt=""></a>
            </div>
            <div class="text">Подпись к синтетическому фото.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  const secondPart = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Exported Data</title>
</head>
<body>
  <div class="page_wrap">
    <div class="page_header">
      <div class="content"><div class="text bold">Демо-чат TeleJSON</div></div>
    </div>
    <div class="page_body chat_page">
      <div class="history">
        <div class="message default clearfix" id="message4">
          <div class="body">
            <div class="pull_right date details" title="01.05.2025 09:03:00 UTC+03:00">09:03</div>
            <div class="from_name">Анна</div>
            <div class="media_wrap clearfix">
              <a class="photo_wrap clearfix pull_left" href="photos/photo_demo.jpg"><img class="photo" src="photos/photo_demo.jpg" alt=""></a>
            </div>
            <div class="text">Подпись к синтетическому фото.</div>
          </div>
        </div>
        <div class="message default clearfix joined" id="message5">
          <div class="body">
            <div class="pull_right date details" title="01.05.2025 09:04:00 UTC+03:00">09:04</div>
            <div class="text">Joined-сообщение: отправитель наследуется.</div>
          </div>
        </div>
        <div class="message default clearfix" id="message6">
          <div class="body">
            <div class="pull_right date details" title="01.05.2025 09:05:00 UTC+03:00">09:05</div>
            <div class="from_name">Борис</div>
            <div class="forwarded body">
              <div class="from_name">Канал примеров<span class="details"> 01.05.2025 08:00:00 UTC+03:00</span></div>
              <div class="text">Пересланный текст из синтетического канала.</div>
              <div class="media_wrap clearfix">
                <div class="media clearfix pull_left media_file">
                  <div class="body">
                    <div class="title bold">demo-notes.pdf</div>
                    <div class="status details">2.4 KB</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  root.TeleJSONExample = {
    files: [
      { name: 'messages.html', html: firstPart },
      { name: 'messages2.html', html: secondPart }
    ]
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
