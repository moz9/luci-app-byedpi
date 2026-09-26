# AGENTS.md

LuCI-приложение для ByeDPI на OpenWrt: фронтенд `htdocs/`, shell-хелперы в
`root/usr/libexec/`, установщик `install.sh` и деинсталлятор `uninstall.sh`.
README и интерфейс на русском.

## Перед началом работы

Прочитайте `docs/REVIEW-BACKLOG.md`: там открытые находки ревью с приоритетами и
местами в коде. Беретесь за пункт — отметьте его статус в том же файле (`[x]` + коммит
или `[-]` + причина) в том же изменении.

## Правила

- Целевая среда — OpenWrt: busybox `ash`, POSIX `awk`, `jsonfilter`, `jshn.sh`, `uci`,
  `procd`. Не используйте bash-измы, GNU-расширения, Python и Node на роутере.
- Стратегии никогда не исполняются через `eval`; тестер не меняет UCI и не
  перезапускает рабочий ByeDPI (см. комментарии в `byedpi-luci-test`).
- Изменения сервиса и установщика сериализуются через `/tmp/byedpi-luci-test-v2.start`.
- Проверка: `node --test tests/*.test.cjs` (Node.js + POSIX sh + awk). Для нового
  поведения добавляйте тест. Реальную проверку на роутере тесты не заменяют.
- При изменении списка устанавливаемых файлов синхронизируйте `INSTALL_PATHS`
  и `chmod` в `install.sh`, `uninstall.sh`, `Makefile` и `tests/installer.test.cjs`.
- Версия указана в `Makefile` (`PKG_VERSION`) и в `main.js`; меняйте обе.
