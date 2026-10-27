# freelens-structured-logs

Расширение для [Freelens](https://freelens.app/), которое показывает логи пода в формате Logstash JSON в читаемом виде. Каждая запись — одна строка: время, цветной уровень, короткое имя логгера и сообщение. По клику строка раскрывается в полный JSON и `stack_trace`.

Расширение подойдёт, если сервис пишет логи через [logstash-logback-encoder](https://github.com/logfellow/logstash-logback-encoder) или в совместимом формате — по одному JSON-объекту на строку:

```json
{"@timestamp":"2026-10-20T18:42:09.879Z","level":"INFO","logger_name":"com.example.app.AppKt","message":"Started","stack_trace":"..."}
```

Строки, которые не разбираются как JSON, тоже показываются, но как есть.

## Что понадобится

- Freelens 1.10.x. Freelens 2.x и Lens не поддерживаются.
- Доступ к Kubernetes-кластеру через kubeconfig (тот же, что для `kubectl`).

## 1. Установить Freelens

macOS:

```bash
brew install --cask freelens
```

Windows и Linux: скачать установщик со [страницы релизов Freelens](https://github.com/freelensapp/freelens/releases) или с [freelens.app](https://freelens.app/).

Если Freelens уже стоит, проверьте версию в меню **Freelens → About Freelens**: нужна 1.10.x.

## 2. Подключить кластер

Freelens сам находит кластеры из kubeconfig-файлов в `~/.kube`. Откройте **Catalog → Clusters** и кликните нужный кластер. Если кластера в списке нет, нажмите **+** внизу справа и выберите **Add from kubeconfig**.

Проверка: в кластере открывается раздел **Workloads → Pods** и в нём видны поды.

## 3. Установить расширение

1. Откройте **Extensions**: `Cmd+Shift+E` на macOS или `Ctrl+Shift+E` на Windows и Linux.
2. Вставьте в поле **Name or file path or URL** адрес пакета:

   ```
   https://github.com/velios/freelens-structured-logs/releases/download/v0.1.0/freelens-structured-logs-0.1.0.tgz
   ```

3. Нажмите **Install**.

Расширение появится в списке **Installed extensions** со статусом **Enabled**. Если статус **Disabled**, включите его через меню ⋮ в строке расширения.

Если Freelens не может скачать файл (например, из-за прокси), скачайте `.tgz` со [страницы релизов](https://github.com/velios/freelens-structured-logs/releases) и перетащите его на экран Extensions.

## 4. Открыть логи пода

1. В кластере откройте **Workloads → Pods**.
2. Откройте меню пода (⋮ в конце строки или панель пода справа) и выберите **Structured logs**.

Внизу откроется вкладка с пометкой `{ }` — это логи пода в разобранном виде. Сразу загружаются последние 1000 строк, дальше логи идут в реальном времени.

Что можно делать во вкладке:

- **Container** — выбрать контейнер пода, включая init-контейнеры.
- **Previous** — показать логи прошлого запуска контейнера, например после падения.
- **Search** — поиск по всей строке без учёта регистра. Кнопка `.*` включает регулярные выражения.
- **TRACE / DEBUG / INFO / WARN / ERROR** — показать или скрыть уровни. Строки без уровня видны всегда.
- Клик по строке — раскрыть полный JSON и `stack_trace`. **Copy** копирует JSON.
- Прокрутка вверх ставит автопрокрутку на паузу. Кнопка **↓ N новых** возвращает вниз.
- **← Pod** — открыть карточку пода.

Вкладки переживают перезапуск Freelens. Закрытие вкладки останавливает поток логов.

## Обновление и удаление

Обновление: установите `.tgz` новой версии со [страницы релизов](https://github.com/velios/freelens-structured-logs/releases) так же, как в шаге 3.

Удаление: **Extensions** → меню ⋮ расширения → **Uninstall**.

## Ограничения

- Один под на вкладку.
- В памяти хранятся последние 10 000 записей, старые отбрасываются.
- Расширение встраивается в нижнюю панель Freelens через её внутреннюю разметку. Новая версия Freelens может это сломать.

## Разработка

Нужны [mise](https://mise.jdx.dev/) и pnpm.

```bash
mise install
pnpm install
pnpm build
pnpm test
```

Чтобы Freelens подхватил локальную сборку, при **запущенном** Freelens создайте ссылку на папку репозитория:

```bash
ln -s "$PWD" ~/.freelens/extensions/freelens-structured-logs
```

Hot-reload нет: после каждой пересборки перезапускайте Freelens. На macOS:

```bash
osascript -e 'quit app "Freelens"' && sleep 3 && open -a Freelens
```

Пакет для релиза собирает `pnpm pack --pack-destination dist`, сборка запускается перед упаковкой сама. Устройство и принятые решения описаны в [SPEC.md](SPEC.md).

## Лицензия

[MIT](LICENSE)
