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
- полная установка в одну команду: ByeDPI, LuCI-встройка и секция Podkop.

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
После установки ByeDPI включается и запускается.

Если установлен Podkop, установщик создает отдельную секцию `byedpi` только если
ее еще нет. Уже существующая секция `byedpi` не перезаписывается.

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

Установщик делает:

- ставит ByeDPI, если `/usr/bin/ciadpi` и `/etc/init.d/byedpi` отсутствуют;
- нормализует `byedpi.main.cmd_opts` и `byedpi.main.options`;
- включает и запускает ByeDPI;
- ставит файлы `luci-app-byedpi`;
- если найден Podkop и секции `byedpi` еще нет, добавляет:

```sh
config section 'byedpi'
	option connection_type 'proxy'
	option proxy_config_type 'url'
	option proxy_string 'socks5://127.0.0.1:1080#byedpi'
	option resolve_real_ip_for_routing '1'
	list community_lists 'youtube'
```

Список по умолчанию - `youtube`. Можно заменить его при установке:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | PODKOP_BYEDPI_COMMUNITY_LISTS="youtube google" sh
```

Если секция Podkop не нужна:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | PODKOP_CONFIGURE=0 sh
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
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | sh
```

Установщик перезаписывает файлы этой LuCI-встройки и очищает кэш LuCI. Если
ByeDPI уже установлен, он не переустанавливается. Если секция `podkop.byedpi`
уже есть, она не перезаписывается.

## Удаление

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/uninstall.sh | sh
```

Удаление убирает файлы `luci-app-byedpi`. Если установка создала секцию
`podkop.byedpi`, она удаляется. Если установка сама поставила пакет ByeDPI, он
удаляется. Если ByeDPI уже был установлен до запуска установщика, пакет не
удаляется, а состояние сервиса возвращается к сохраненному перед установкой.

Для принудительного удаления секции Podkop и пакета ByeDPI:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/uninstall.sh | REMOVE_PODKOP_BYEDPI=1 REMOVE_BYEDPI=1 sh
```

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
