# luci-app-byedpi

LuCI-страница для управления ByeDPI на OpenWrt.

Добавляет раздел:

```text
Службы -> ByeDPI
```

Прямой путь:

```text
/cgi-bin/luci/admin/services/byedpi
```

## Что умеет

- показывает статус `ciadpi`, init-скрипта, UCI-конфига и SOCKS-порта;
- запускает, останавливает и перезапускает ByeDPI;
- сохраняет аргументы `ciadpi` в `byedpi.main.cmd_opts` и `byedpi.main.options`;
- дает выбрать готовую стратегию или вписать аргументы вручную;
- проверяет доступ через `socks5://127.0.0.1:1080`;
- тестирует стратегии и возвращает прежнюю стратегию после теста;
- при установке может добавить секцию `podkop.byedpi`.

## Требования

- OpenWrt с LuCI;
- `curl` или `wget`;
- стандартные компоненты LuCI/OpenWrt: `uci`, `jsonfilter`, `jshn.sh`.

Если ByeDPI еще не установлен, установщик попробует поставить пакет `byedpi`
из релизов [DPITrickster/ByeDPI-OpenWrt](https://github.com/DPITrickster/ByeDPI-OpenWrt).

## Установка

На роутере по SSH:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | sh
```

Или через `curl`:

```sh
curl -fsSL https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | sh
```

Установщик:

- ставит ByeDPI, если нет `/usr/bin/ciadpi` или `/etc/init.d/byedpi`;
- включает и запускает ByeDPI;
- ставит файлы LuCI-встройки;
- очищает кэш LuCI;
- если найден Podkop, создает или нормализует секцию `podkop.byedpi`.

Секция Podkop по умолчанию:

```sh
config section 'byedpi'
	option connection_type 'proxy'
	option proxy_config_type 'url'
	option proxy_string 'socks5://127.0.0.1:1080#byedpi'
	option resolve_real_ip_for_routing '1'
```

Если `podkop.byedpi` уже существует, установщик обновляет только основные поля
для прокси и диагностики. Списки `community_lists` установщик не задает:
пользователь выбирает их сам в Podkop.

## Опции установки

Не ставить пакет ByeDPI автоматически:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | BYEDPI_AUTO_INSTALL=0 sh
```

Не трогать Podkop:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | PODKOP_CONFIGURE=0 sh
```

Поставить из другой ветки или форка:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | REPO_URL=https://github.com/moz9/luci-app-byedpi REF=main sh
```

## Обновление

Повторно запустите установщик:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/install.sh | sh
```

## Удаление

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/uninstall.sh | sh
```

Удаление убирает файлы `luci-app-byedpi`. Если установщик сам создавал
`podkop.byedpi`, секция удаляется. Если установщик сам ставил пакет ByeDPI,
пакет удаляется. Если ByeDPI был установлен заранее, пакет остается.

Принудительно удалить секцию Podkop и пакет ByeDPI:

```sh
wget -qO- https://raw.githubusercontent.com/moz9/luci-app-byedpi/main/uninstall.sh | REMOVE_PODKOP_BYEDPI=1 REMOVE_BYEDPI=1 sh
```

## Сборка пакета

Скопируйте каталог в OpenWrt build tree или package feed:

```sh
make package/luci-app-byedpi/compile
```

OpenWrt 25.12+ собирает `.apk`, старые версии собирают `.ipk`.

## Атрибуция

- ByeDPI для OpenWrt: [DPITrickster/Podkop-ByeDPI-OpenWRT](https://github.com/DPITrickster/Podkop-ByeDPI-OpenWRT)
- Пакеты ByeDPI: [DPITrickster/ByeDPI-OpenWrt](https://github.com/DPITrickster/ByeDPI-OpenWrt)
- Часть стратегий и логика тестера адаптированы из [romanvht/ByeDPIManager](https://github.com/romanvht/ByeDPIManager)

Лицензия: GPL-3.0.
