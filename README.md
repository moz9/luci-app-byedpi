# luci-app-byedpi

`luci-app-byedpi` - отдельная LuCI-встройка для OpenWrt, которая добавляет
страницу `Службы -> ByeDPI` и позволяет менять стратегию `ciadpi` из веб-интерфейса.

Проект не изменяет Podkop и не заменяет официальный пакет ByeDPI. Это только
удобная панель управления поверх уже установленного ByeDPI для OpenWrt.

## Возможности

- просмотр статуса сервиса ByeDPI;
- запуск, остановка и перезапуск сервиса;
- выбор готовой стратегии из списка;
- ручное редактирование аргументов `ciadpi`;
- сохранение стратегии в `byedpi.main.cmd_opts` и `byedpi.main.options`;
- диагностика `ciadpi`, init-скрипта, UCI-конфига, SOCKS-порта и интеграции Podkop;
- тестер стратегий через `socks5://127.0.0.1:1080`;
- тест выбранной, текущей, топ-10 или всех стратегий;
- остановка выполняющейся очереди тестов с возвратом прежней стратегии;
- автоматическое добавление секции `podkop.byedpi` при наличии Podkop.

## Источники и атрибуция

Этот репозиторий является отдельной LuCI-встройкой и не является официальной
частью перечисленных проектов.

- ByeDPI для OpenWrt ожидается из проекта
  [DPITrickster/Podkop-ByeDPI-OpenWRT](https://github.com/DPITrickster/Podkop-ByeDPI-OpenWRT).
- Готовые пакеты ByeDPI берутся из релизов
  [DPITrickster/ByeDPI-OpenWrt](https://github.com/DPITrickster/ByeDPI-OpenWrt).
- Список стратегий, список доменов и идея тестера адаптированы из
  [romanvht/ByeDPIManager](https://github.com/romanvht/ByeDPIManager).

Так как часть данных и логика тестера адаптированы из `ByeDPIManager`, проект
распространяется под GPL-3.0.

## Требования

- OpenWrt с LuCI;
- `curl` или `wget` для установки;
- `jsonfilter`, `uci`, `jshn.sh` из стандартной LuCI/OpenWrt-среды.

Если ByeDPI еще не установлен, установщик попробует скачать и поставить пакет
ByeDPI из релизов
[DPITrickster/ByeDPI-OpenWrt](https://github.com/DPITrickster/ByeDPI-OpenWrt).
Пакет выбирается по архитектуре роутера и пакетному менеджеру `apk` или `opkg`.

Оригинальная инструкция по ручной установке ByeDPI и настройке связки с Podkop:

```sh
https://github.com/DPITrickster/Podkop-ByeDPI-OpenWRT
```

## Быстрая установка

Выполните на роутере по SSH:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | sh
```

Если `wget` не умеет HTTPS, используйте `curl`:

```sh
curl -fsSL https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | sh
```

После установки откройте LuCI:

```text
Службы -> ByeDPI
```

Прямой путь:

```text
/cgi-bin/luci/admin/services/byedpi
```

Если нужно поставить только LuCI-встройку и не трогать пакет ByeDPI:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | BYEDPI_AUTO_INSTALL=0 sh
```

Если нужно отключить автоматическую настройку Podkop:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | PODKOP_CONFIGURE=0 sh
```

## Установка из другой ветки или форка

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | REPO_URL=https://github.com/moz9/luci-app-byedpi REF=main sh
```

Можно поставить из локальной копии репозитория:

```sh
git clone https://github.com/moz9/luci-app-byedpi.git
cd luci-app-byedpi
sh install.sh
```

## Обновление

Повторно запустите установщик:

```sh
wget -O /tmp/install-luci-app-byedpi.sh https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh
sh /tmp/install-luci-app-byedpi.sh
```

Установщик перезаписывает только файлы этой LuCI-встройки и очищает кэш LuCI.
Если ByeDPI уже установлен, он не переустанавливается. Конфиг
`/etc/config/byedpi` не меняется, кроме нормализации `cmd_opts/options` и случая,
когда вы сами нажимаете `Сохранить и перезапустить` в интерфейсе.

Если установлен Podkop, установщик создает или обновляет только named section
`podkop.byedpi`:

```sh
podkop.byedpi=section
podkop.byedpi.proxy_string='socks5://127.0.0.1:1080#byedpi'
podkop.byedpi.resolve_real_ip_for_routing='1'
```

Остальные секции Podkop, списки доменов, прокси и правила маршрутизации не
перезаписываются.

## Удаление

```sh
wget -O /tmp/uninstall-luci-app-byedpi.sh https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/uninstall.sh
sh /tmp/uninstall-luci-app-byedpi.sh
```

Удаление убирает только файлы `luci-app-byedpi`. ByeDPI, Podkop и
`/etc/config/byedpi` не удаляются.

## Сборка пакета OpenWrt

Скопируйте каталог в build tree или package feed OpenWrt и выполните:

```sh
make package/luci-app-byedpi/compile
```

На OpenWrt 25.12+ сборка OpenWrt создаст `.apk`, на старых версиях - `.ipk`.

## Как работает тестер

Тестер временно:

1. сохраняет текущую стратегию ByeDPI;
2. перезапускает ByeDPI с проверяемой стратегией;
3. проверяет домены через `socks5://127.0.0.1:1080`;
4. возвращает прежнюю стратегию и прежнее состояние сервиса.

Кнопка `Стоп` останавливает очередь тестов и возвращает прежнюю стратегию после
завершения текущего сетевого запроса.

## Безопасность и приватность

- проект не отправляет телеметрию;
- не хранит пароли, токены, ключи или адреса ваших устройств;
- работает локально на роутере через LuCI ACL и helper `/usr/libexec/byedpi-luci`;
- тесты выполняют только сетевые запросы к доменам из
  `/usr/share/byedpi-luci/domains.txt` через локальный SOCKS ByeDPI.

## Лицензия

GPL-3.0. См. [LICENSE](LICENSE).
